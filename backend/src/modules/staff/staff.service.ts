import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateStaffDto) {
    const admin = await this.getAdminSchool(authUser);
    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await transaction.user.findUnique({
          where: { authUserId: input.authUserId },
          select: { id: true, schoolId: true, staffProfile: { select: { id: true } } },
        });
        if (existing?.schoolId && existing.schoolId !== admin.schoolId) {
          throw new ConflictException('User belongs to another school');
        }
        if (existing?.staffProfile) {
          throw new ConflictException('Staff profile already exists');
        }
        const studentWithNfc = await transaction.student.findUnique({
          where: { nfcId: input.nfcId.trim() },
          select: { id: true },
        });
        if (studentWithNfc) {
          throw new ConflictException('This NFC ID is already assigned to a student');
        }

        const user = existing
          ? await transaction.user.update({
              where: { id: existing.id },
              data: {
                email: input.email.toLowerCase().trim(),
                displayName: input.displayName.trim(),
                organizationId: admin.organizationId,
                schoolId: admin.schoolId,
                status: 'ACTIVE',
              },
            })
          : await transaction.user.create({
              data: {
                authUserId: input.authUserId,
                email: input.email.toLowerCase().trim(),
                displayName: input.displayName.trim(),
                organizationId: admin.organizationId,
                schoolId: admin.schoolId,
                status: 'ACTIVE',
              },
            });
        const teacherRole = await transaction.role.findUnique({
          where: { name: 'Teacher' },
        });
        if (!teacherRole) {
          throw new NotFoundException('Teacher role is missing; run the seed first');
        }
        await transaction.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: teacherRole.id } },
          create: { userId: user.id, roleId: teacherRole.id },
          update: {},
        });
        return transaction.staffProfile.create({
          data: {
            userId: user.id,
            schoolId: admin.schoolId,
            employeeNo: input.employeeNo.trim(),
            nfcId: input.nfcId.trim(),
          },
          include: { user: true },
        });
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Employee number, email, or NFC ID already exists');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser) {
    const admin = await this.getAdminSchool(authUser);
    return this.database.staffProfile.findMany({
      where: { schoolId: admin.schoolId },
      orderBy: { employeeNo: 'asc' },
      include: { user: true },
    });
  }

  async findOne(authUser: SupabaseUser, staffId: string) {
    const admin = await this.getAdminSchool(authUser);
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: admin.schoolId },
      include: { user: true },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');
    return staff;
  }

  async update(authUser: SupabaseUser, staffId: string, input: UpdateStaffDto) {
    const existing = await this.findOne(authUser, staffId);
    try {
      return await this.database.$transaction(async (transaction) => {
        if (input.nfcId !== undefined) {
          const studentWithNfc = await transaction.student.findUnique({
            where: { nfcId: input.nfcId.trim() },
            select: { id: true },
          });
          if (studentWithNfc) {
            throw new ConflictException('This NFC ID is already assigned to a student');
          }
        }
        const staff = await transaction.staffProfile.update({
          where: { id: staffId },
          data: {
            employeeNo: input.employeeNo?.trim(),
            nfcId: input.nfcId?.trim(),
          },
        });
        if (input.displayName !== undefined) {
          await transaction.user.update({
            where: { id: staff.userId },
            data: { displayName: input.displayName.trim() },
          });
        }
        return transaction.staffProfile.findUniqueOrThrow({
          where: { id: staff.id },
          include: { user: true },
        });
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Employee number or NFC ID already exists');
      }
      throw error;
    }
  }

  private async getAdminSchool(authUser: SupabaseUser) {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { organizationId: true, schoolId: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE' || !user.schoolId || !user.organizationId) {
      throw new ForbiddenException('Active school administrator profile is required');
    }
    return { organizationId: user.organizationId, schoolId: user.schoolId };
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
