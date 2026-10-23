import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ROLE } from '../../common/access/roles';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  phone: true,
  status: true,
} as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async create(authUser: SupabaseUser, input: CreateStaffDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const email = input.email.trim().toLowerCase();
    await this.assertNfcFree(input.nfcId);

    let authUserId = input.authUserId;
    let createdLogin = false;
    if (authUserId) {
      const account = await this.supabaseAuth.getManagedUser(authUserId);
      if (account.email?.toLowerCase() !== email) {
        throw new BadRequestException('Email does not match the login account');
      }
    } else {
      if (!input.password) {
        throw new BadRequestException('Provide authUserId or a password for the new login');
      }
      const account = await this.supabaseAuth.createManagedUser({
        email,
        password: input.password,
        displayName: input.displayName.trim(),
      });
      authUserId = account.id;
      createdLogin = true;
    }

    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await transaction.user.findUnique({
          where: { authUserId },
          select: { id: true, schoolId: true, status: true, staffProfile: { select: { id: true } } },
        });
        if (existing?.schoolId && existing.schoolId !== context.schoolId) {
          throw new ConflictException('User belongs to another school');
        }
        if (existing?.staffProfile) {
          throw new ConflictException('Staff profile already exists');
        }
        if (existing && existing.status === 'SUSPENDED') {
          throw new ConflictException('This user is suspended; activate the account first');
        }
        const teacherRole = await transaction.role.findUniqueOrThrow({
          where: { name: ROLE.TEACHER },
        });
        const data = {
          email,
          displayName: input.displayName.trim(),
          phone: input.phone?.trim() || null,
          organizationId: context.organizationId,
          schoolId: context.schoolId,
          status: 'ACTIVE' as const,
        };
        const user = existing
          ? await transaction.user.update({ where: { id: existing.id }, data })
          : await transaction.user.create({ data: { ...data, authUserId: authUserId as string } });
        await transaction.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: teacherRole.id } },
          create: { userId: user.id, roleId: teacherRole.id },
          update: {},
        });
        const staff = await transaction.staffProfile.create({
          data: {
            userId: user.id,
            schoolId: context.schoolId,
            employeeNo: input.employeeNo.trim(),
            nfcId: input.nfcId.trim(),
            designation: input.designation?.trim() || null,
          },
          include: { user: { select: USER_SELECT } },
        });
        await this.audit.record(
          context,
          {
            action: 'staff.created',
            entityType: 'staff',
            entityId: staff.id,
            newValue: { email, employeeNo: staff.employeeNo },
          },
          transaction,
        );
        return staff;
      });
    } catch (error) {
      if (createdLogin && authUserId) {
        await this.supabaseAuth.deleteManagedUser(authUserId);
      }
      if (this.isUniqueError(error)) {
        throw new ConflictException('Employee number, email, or NFC ID already exists');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    return this.database.staffProfile.findMany({
      where: { schoolId: context.schoolId },
      orderBy: { employeeNo: 'asc' },
      include: { user: { select: USER_SELECT } },
    });
  }

  async findOne(authUser: SupabaseUser, staffId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && context.staffId !== staffId) {
      this.access.assertLeader(context);
    }
    return this.scoped(context, staffId);
  }

  async update(authUser: SupabaseUser, staffId: string, input: UpdateStaffDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const existing = await this.scoped(context, staffId);
    if (input.nfcId !== undefined) {
      await this.assertNfcFree(input.nfcId);
    }
    try {
      const updated = await this.database.$transaction(async (transaction) => {
        const staff = await transaction.staffProfile.update({
          where: { id: staffId },
          data: {
            employeeNo: input.employeeNo?.trim(),
            nfcId: input.nfcId?.trim(),
            designation: input.designation === undefined ? undefined : input.designation.trim() || null,
          },
        });
        if (input.displayName !== undefined || input.phone !== undefined) {
          await transaction.user.update({
            where: { id: staff.userId },
            data: {
              displayName: input.displayName?.trim(),
              phone: input.phone === undefined ? undefined : input.phone.trim() || null,
            },
          });
        }
        await this.audit.record(
          context,
          {
            action: 'staff.updated',
            entityType: 'staff',
            entityId: staffId,
            oldValue: {
              employeeNo: existing.employeeNo,
              nfcId: existing.nfcId,
              displayName: existing.user.displayName,
            },
            newValue: input,
          },
          transaction,
        );
        return transaction.staffProfile.findUniqueOrThrow({
          where: { id: staff.id },
          include: { user: { select: USER_SELECT } },
        });
      });
      if (input.displayName) {
        await this.supabaseAuth.updateManagedUser(
          (await this.database.user.findUniqueOrThrow({ where: { id: existing.userId } })).authUserId,
          { displayName: input.displayName.trim() },
        );
      }
      return updated;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Employee number or NFC ID already exists');
      }
      throw error;
    }
  }

  async setActive(authUser: SupabaseUser, staffId: string, active: boolean) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const staff = await this.scoped(context, staffId);
    if (staff.userId === context.userId) {
      throw new BadRequestException('You cannot change your own account status');
    }
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: staff.userId },
        data: { status: active ? 'ACTIVE' : 'SUSPENDED' },
        select: USER_SELECT,
      });
      if (!active) {
        await transaction.userSession.updateMany({
          where: { userId: staff.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        context,
        {
          action: active ? 'staff.activated' : 'staff.deactivated',
          entityType: 'staff',
          entityId: staffId,
        },
        transaction,
      );
      return { ...staff, user };
    });
  }

  private async scoped(context: SchoolContext, staffId: string) {
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
      include: { user: { select: USER_SELECT } },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');
    return staff;
  }

  private async assertNfcFree(nfcId: string) {
    const studentWithNfc = await this.database.student.findUnique({
      where: { nfcId: nfcId.trim() },
      select: { id: true },
    });
    if (studentWithNfc) {
      throw new ConflictException('This NFC ID is already assigned to a student');
    }
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
