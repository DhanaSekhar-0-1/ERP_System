import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { pageArgs, paged } from '../../common/http/pagination';
import { ROLE } from '../../common/access/roles';
import {
  CreateGuardianAccountDto,
  CreateGuardianDto,
  LinkStudentDto,
  ListGuardiansDto,
  UpdateChildContactDto,
  UpdateGuardianDto,
  UpdateMyProfileDto,
} from './dto/guardians.dto';

const CHILD_SELECT = {
  isPrimary: true,
  student: {
    select: { id: true, admissionNo: true, firstName: true, lastName: true, isArchived: true },
  },
} as const;

@Injectable()
export class GuardiansService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async create(authUser: SupabaseUser, input: CreateGuardianDto) {
    const context = await this.access.schoolContext(authUser);
    const guardian = await this.database.guardian.create({
      data: {
        schoolId: context.schoolId,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        relation: input.relation?.trim() || null,
        address: input.address?.trim() || null,
      },
    });
    await this.audit.record(context, {
      action: 'guardian.created',
      entityType: 'guardian',
      entityId: guardian.id,
      newValue: { name: guardian.name },
    });
    return guardian;
  }

  async findMany(authUser: SupabaseUser, input: ListGuardiansDto) {
    const context = await this.access.schoolContext(authUser);
    const search = input.search?.trim();
    const where: Prisma.GuardianWhereInput = {
      AND: [
        await this.visibleWhere(context),
        search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [items, total] = await this.database.$transaction([
      this.database.guardian.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(input),
        include: { students: { select: CHILD_SELECT } },
      }),
      this.database.guardian.count({ where }),
    ]);
    return paged(items, total, input);
  }

  async findOne(authUser: SupabaseUser, guardianId: string) {
    const context = await this.access.schoolContext(authUser);
    const guardian = await this.database.guardian.findFirst({
      where: { AND: [{ id: guardianId }, await this.visibleWhere(context)] },
      include: { students: { select: CHILD_SELECT } },
    });
    if (!guardian) {
      throw new NotFoundException('Guardian not found');
    }
    return guardian;
  }

  async update(
    authUser: SupabaseUser,
    guardianId: string,
    input: UpdateGuardianDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.scoped(context, guardianId);
    const data = {
      name: input.name?.trim(),
      phone: input.phone === undefined ? undefined : input.phone.trim() || null,
      email: input.email === undefined ? undefined : input.email.trim().toLowerCase() || null,
      relation: input.relation === undefined ? undefined : input.relation.trim() || null,
      address: input.address === undefined ? undefined : input.address.trim() || null,
    };
    const diff = this.audit.changes(existing, data);
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.guardian.update({ where: { id: guardianId }, data });
      if (diff.changed) {
        await this.audit.record(
          context,
          {
            action: 'guardian.updated',
            entityType: 'guardian',
            entityId: guardianId,
            oldValue: diff.oldValue,
            newValue: diff.newValue,
          },
          transaction,
        );
      }
      return updated;
    });
  }

  async children(authUser: SupabaseUser, guardianId: string) {
    const guardian = await this.findOne(authUser, guardianId);
    return guardian.students;
  }

  async linkStudent(
    authUser: SupabaseUser,
    guardianId: string,
    input: LinkStudentDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    await this.scoped(context, guardianId);
    const student = await this.database.student.findFirst({
      where: { id: input.studentId, schoolId: context.schoolId },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    try {
      const link = await this.database.studentGuardian.create({
        data: { guardianId, studentId: input.studentId, isPrimary: input.isPrimary },
      });
      await this.audit.record(context, {
        action: 'guardian.student-linked',
        entityType: 'guardian',
        entityId: guardianId,
        newValue: { studentId: input.studentId, isPrimary: input.isPrimary },
      });
      return link;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Guardian is already linked to this student');
      }
      throw error;
    }
  }

  async unlinkStudent(authUser: SupabaseUser, guardianId: string, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.scoped(context, guardianId);
    const result = await this.database.studentGuardian.deleteMany({
      where: { guardianId, studentId },
    });
    if (!result.count) {
      throw new NotFoundException('Guardian is not linked to this student');
    }
    await this.audit.record(context, {
      action: 'guardian.student-unlinked',
      entityType: 'guardian',
      entityId: guardianId,
      oldValue: { studentId },
    });
    return { guardianId, studentId, unlinked: true };
  }

  /** Gives a guardian a parent login with the Parent role. */
  async createAccount(
    authUser: SupabaseUser,
    guardianId: string,
    input: CreateGuardianAccountDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const guardian = await this.scoped(context, guardianId);
    if (guardian.userId) {
      throw new ConflictException('This guardian already has a login');
    }
    const email = input.email.trim().toLowerCase();
    const authAccount = input.password
      ? await this.supabaseAuth.createManagedUser({
          email,
          password: input.password,
          displayName: guardian.name,
        })
      : await this.supabaseAuth.inviteManagedUser({ email, displayName: guardian.name });
    try {
      return await this.database.$transaction(async (transaction) => {
        const parentRole = await transaction.role.findUniqueOrThrow({
          where: { name: ROLE.PARENT },
        });
        const user = await transaction.user.create({
          data: {
            authUserId: authAccount.id,
            email,
            displayName: guardian.name,
            phone: guardian.phone,
            organizationId: context.organizationId,
            schoolId: context.schoolId,
            status: input.password ? 'ACTIVE' : 'INVITED',
            roles: { create: { roleId: parentRole.id } },
          },
        });
        const updated = await transaction.guardian.update({
          where: { id: guardianId },
          data: { userId: user.id, email },
          include: { students: { select: CHILD_SELECT } },
        });
        await this.audit.record(
          context,
          {
            action: 'guardian.account-created',
            entityType: 'guardian',
            entityId: guardianId,
            newValue: { userId: user.id, email },
          },
          transaction,
        );
        return { guardian: updated, userId: user.id, loginEmail: email };
      });
    } catch (error) {
      await this.supabaseAuth.deleteManagedUser(authAccount.id);
      if (this.isUniqueError(error)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async myChildren(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.guardianId) {
      return [];
    }
    const links = await this.database.studentGuardian.findMany({
      where: { guardianId: context.guardianId, student: { isArchived: false } },
      select: {
        isPrimary: true,
        student: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: { academicYear: true, class: true, section: true },
            },
          },
        },
      },
    });
    return links.map((link) => ({ ...link.student, isPrimary: link.isPrimary }));
  }

  async myChild(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.assertMyChild(context, studentId);
    return this.database.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        enrollments: { include: { academicYear: true, class: true, section: true } },
      },
    });
  }

  async updateMyProfile(authUser: SupabaseUser, input: UpdateMyProfileDto) {
    const context = await this.access.context(authUser);
    const user = await this.database.user.update({
      where: { id: context.userId },
      data: {
        displayName: input.displayName?.trim(),
        phone: input.phone === undefined ? undefined : input.phone.trim() || null,
      },
      select: { id: true, email: true, displayName: true, phone: true },
    });
    if (input.displayName) {
      await this.supabaseAuth.updateManagedUser(context.authUserId, {
        displayName: input.displayName.trim(),
      });
    }
    if (context.guardianId && (input.phone !== undefined || input.address !== undefined)) {
      await this.database.guardian.update({
        where: { id: context.guardianId },
        data: {
          phone: input.phone === undefined ? undefined : input.phone.trim() || null,
          address: input.address === undefined ? undefined : input.address.trim() || null,
        },
      });
    }
    await this.audit.record(context, {
      action: 'profile.updated',
      entityType: 'user',
      entityId: context.userId,
      newValue: input,
    });
    return user;
  }

  /** Tier 1: a parent may update a child's contact details directly; the change is logged. */
  async updateChildContact(
    authUser: SupabaseUser,
    studentId: string,
    input: UpdateChildContactDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const student = await this.assertMyChild(context, studentId);
    const data = {
      phone: input.phone === undefined ? undefined : input.phone.trim() || null,
      address: input.address === undefined ? undefined : input.address.trim() || null,
    };
    const diff = this.audit.changes(student, data);
    const updated = await this.database.student.update({
      where: { id: studentId },
      data,
      select: { id: true, phone: true, address: true },
    });
    if (diff.changed) {
      await this.audit.record(context, {
        action: 'student.contact-updated',
        entityType: 'student',
        entityId: studentId,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }
    return updated;
  }

  private async assertMyChild(context: SchoolContext, studentId: string) {
    if (!context.guardianId) {
      throw new ForbiddenException('Only a linked parent can use this route');
    }
    const link = await this.database.studentGuardian.findFirst({
      where: { guardianId: context.guardianId, studentId },
      select: { student: true },
    });
    if (!link) {
      throw new NotFoundException('Child not found');
    }
    return link.student;
  }

  private async visibleWhere(context: SchoolContext): Promise<Prisma.GuardianWhereInput> {
    const scope = await this.access.studentScope(context);
    if (scope.all) {
      return { schoolId: context.schoolId };
    }
    return {
      schoolId: context.schoolId,
      OR: [
        { students: { some: { studentId: { in: scope.ids } } } },
        ...(context.guardianId ? [{ id: context.guardianId }] : []),
      ],
    };
  }

  private async scoped(context: SchoolContext, guardianId: string) {
    const guardian = await this.database.guardian.findFirst({
      where: { id: guardianId, schoolId: context.schoolId },
    });
    if (!guardian) {
      throw new NotFoundException('Guardian not found');
    }
    return guardian;
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
