import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { pageArgs, paged } from '../../common/http/pagination';
import { ROLE } from '../../common/access/roles';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsDto } from './dto/list-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const IDENTITY_CHANGE = 'student.identity-change';
const IDENTITY_FIELDS = ['admissionNo', 'firstName', 'lastName', 'dateOfBirth'] as const;

@Injectable()
export class StudentsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalEngine,
  ) {}

  onModuleInit(): void {
    this.approvals.register(IDENTITY_CHANGE, {
      onApproved: async (transaction, request, approver) => {
        const changes = (request.payload as { changes: Record<string, string | null> }).changes;
        const before = await transaction.student.findUniqueOrThrow({ where: { id: request.entityId } });
        await transaction.student.update({
          where: { id: request.entityId },
          data: {
            admissionNo: changes.admissionNo ?? undefined,
            firstName: changes.firstName ?? undefined,
            lastName: changes.lastName === undefined ? undefined : changes.lastName,
            dateOfBirth:
              changes.dateOfBirth === undefined
                ? undefined
                : changes.dateOfBirth && new Date(changes.dateOfBirth),
          },
        });
        await this.audit.record(
          approver,
          {
            action: 'student.identity-changed',
            entityType: 'student',
            entityId: request.entityId,
            oldValue: Object.fromEntries(
              Object.keys(changes).map((key) => [key, before[key as keyof typeof before]]),
            ),
            newValue: changes,
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
    });
  }

  async create(authUser: SupabaseUser, input: CreateStudentDto) {
    const context = await this.access.schoolContext(authUser);
    await this.assertNfcFree(input.nfcId);

    const studentId = randomUUID();
    const displayName = `${input.firstName.trim()} ${input.lastName?.trim() ?? ''}`.trim();
    const loginEmail = `${studentId}@students.erp.local`;
    const managedAuthUser = await this.supabaseAuth.createManagedUser({
      email: loginEmail,
      password: input.password,
      displayName,
    });

    try {
      const result = await this.database.$transaction(async (transaction) => {
        const studentRole = await transaction.role.findUnique({
          where: { name: ROLE.STUDENT },
        });
        if (!studentRole) {
          throw new NotFoundException('Student role is missing; run the seed first');
        }
        const erpUser = await transaction.user.create({
          data: {
            authUserId: managedAuthUser.id,
            email: loginEmail,
            displayName,
            status: 'ACTIVE',
            organizationId: context.organizationId,
            schoolId: context.schoolId,
          },
        });
        await transaction.userRole.create({
          data: { userId: erpUser.id, roleId: studentRole.id },
        });
        const student = await transaction.student.create({
          data: {
            id: studentId,
            userId: erpUser.id,
            schoolId: context.schoolId,
            admissionNo: input.admissionNo.trim(),
            nfcId: input.nfcId.trim(),
            firstName: input.firstName.trim(),
            lastName: input.lastName?.trim() || null,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
            phone: input.phone?.trim() || null,
            address: input.address?.trim() || null,
          },
        });
        await this.audit.record(
          context,
          {
            action: 'student.created',
            entityType: 'student',
            entityId: student.id,
            newValue: { admissionNo: student.admissionNo, firstName: student.firstName },
          },
          transaction,
        );
        return student;
      });
      return { ...result, loginId: result.id };
    } catch (error) {
      await this.supabaseAuth.deleteManagedUser(managedAuthUser.id);
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A student with this admission number or NFC ID already exists',
        );
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser, input: ListStudentsDto) {
    const context = await this.access.schoolContext(authUser);
    const search = input.search?.trim();
    const where: Prisma.StudentWhereInput = {
      ...(await this.access.studentWhere(context)),
      ...(input.includeArchived && context.isLeader ? {} : { isArchived: false }),
      ...(search
        ? {
            OR: [
              { admissionNo: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.database.$transaction([
      this.database.student.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        ...pageArgs(input),
      }),
      this.database.student.count({ where }),
    ]);

    return paged(items, total, input);
  }

  async findOne(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    return this.database.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        enrollments: {
          orderBy: { createdAt: 'desc' },
          include: { academicYear: true, class: true, section: true },
        },
        guardians: {
          select: {
            isPrimary: true,
            guardian: { select: { id: true, name: true, phone: true, email: true, relation: true } },
          },
        },
      },
    });
  }

  async update(
    authUser: SupabaseUser,
    studentId: string,
    input: UpdateStudentDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.access.assertStudentAccess(context, studentId);
    if (!context.isLeader && !context.isTeacher) {
      throw new ForbiddenException('You cannot update student records');
    }

    const identityChanges: Record<string, string | null> = {};
    for (const field of IDENTITY_FIELDS) {
      const value = input[field];
      if (value === undefined) continue;
      const normalized = field === 'lastName' ? value.trim() || null : value.trim();
      const current =
        field === 'dateOfBirth'
          ? existing.dateOfBirth?.toISOString().slice(0, 10) ?? null
          : (existing[field] as string | null);
      const compare =
        field === 'dateOfBirth' && normalized ? normalized.slice(0, 10) : normalized;
      if (compare !== current) {
        identityChanges[field] = normalized;
      }
    }

    let approvalRequest = null;
    if (Object.keys(identityChanges).length) {
      if (!input.reason) {
        throw new BadRequestException(
          'A reason is required to change name, date of birth or admission number',
        );
      }
      approvalRequest = await this.approvals.create(context, {
        type: IDENTITY_CHANGE,
        entityType: 'student',
        entityId: studentId,
        reason: input.reason,
        payload: { changes: identityChanges },
        tier: 4,
        documentFileId: input.documentFileId,
      });
    }

    const directChanges = {
      nfcId: input.nfcId?.trim(),
      phone: input.phone === undefined ? undefined : input.phone.trim() || null,
      address: input.address === undefined ? undefined : input.address.trim() || null,
    };
    if (directChanges.nfcId) {
      await this.assertNfcFree(directChanges.nfcId);
    }
    const diff = this.audit.changes(existing, directChanges);
    let student = existing;
    if (diff.changed) {
      student = await this.database.$transaction(async (transaction) => {
        const updated = await transaction.student.update({
          where: { id: studentId },
          data: directChanges,
        });
        await this.audit.record(
          context,
          {
            action: 'student.updated',
            entityType: 'student',
            entityId: studentId,
            oldValue: diff.oldValue,
            newValue: diff.newValue,
            reason: input.reason,
          },
          transaction,
        );
        return updated;
      });
    }
    return { student, approvalRequest };
  }

  async archive(authUser: SupabaseUser, studentId: string, reason?: string) {
    return this.setArchived(authUser, studentId, true, reason);
  }

  async restore(authUser: SupabaseUser, studentId: string, reason?: string) {
    return this.setArchived(authUser, studentId, false, reason);
  }

  async history(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    const [enrollments, changes] = await Promise.all([
      this.database.enrollment.findMany({
        where: { studentId, schoolId: context.schoolId },
        orderBy: { createdAt: 'asc' },
        include: { academicYear: true, class: true, section: true },
      }),
      context.isLeader
        ? this.database.auditLog.findMany({
            where: { entityType: 'student', entityId: studentId },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
    ]);
    return { enrollments, changes };
  }

  async documents(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    return this.database.fileAsset.findMany({
      where: {
        schoolId: context.schoolId,
        entityType: 'student',
        entityId: studentId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async setArchived(
    authUser: SupabaseUser,
    studentId: string,
    archived: boolean,
    reason?: string,
  ) {
    const context: SchoolContext = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const student = await this.access.assertStudentAccess(context, studentId);
    if (student.isArchived === archived) {
      throw new ConflictException(archived ? 'Student is already archived' : 'Student is already active');
    }
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.student.update({
        where: { id: studentId },
        data: { isArchived: archived },
      });
      if (student.userId) {
        await transaction.user.update({
          where: { id: student.userId },
          data: { status: archived ? 'SUSPENDED' : 'ACTIVE' },
        });
      }
      await this.audit.record(
        context,
        {
          action: archived ? 'student.archived' : 'student.restored',
          entityType: 'student',
          entityId: studentId,
          reason,
        },
        transaction,
      );
      return updated;
    });
  }

  private async assertNfcFree(nfcId: string) {
    const staffWithNfc = await this.database.staffProfile.findUnique({
      where: { nfcId: nfcId.trim() },
      select: { id: true },
    });
    if (staffWithNfc) {
      throw new ConflictException('This NFC ID is already assigned to staff');
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
