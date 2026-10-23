import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import {
  PromoteEnrollmentDto,
  TransferEnrollmentDto,
  WithdrawEnrollmentDto,
} from './dto/enrollment-actions.dto';

const TRANSFER = 'enrollment.transfer';

@Injectable()
export class EnrollmentsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalEngine,
  ) {}

  onModuleInit(): void {
    this.approvals.register(TRANSFER, {
      onApproved: async (transaction, request, approver) => {
        const target = request.payload as { classId: string; sectionId: string };
        const before = await transaction.enrollment.findUniqueOrThrow({
          where: { id: request.entityId },
        });
        await transaction.enrollment.update({
          where: { id: request.entityId },
          data: { classId: target.classId, sectionId: target.sectionId },
        });
        await this.audit.record(
          approver,
          {
            action: 'enrollment.transferred',
            entityType: 'enrollment',
            entityId: request.entityId,
            oldValue: { classId: before.classId, sectionId: before.sectionId },
            newValue: target,
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
    });
  }

  async create(authUser: SupabaseUser, input: CreateEnrollmentDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const placement = await this.placement(context, input);
    const student = await this.database.student.findFirst({
      where: { id: input.studentId, schoolId: context.schoolId, isArchived: false },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    if (placement.academicYear.isClosed) {
      throw new BadRequestException('This academic year is closed');
    }

    try {
      return await this.database.$transaction(async (transaction) => {
        const enrollment = await transaction.enrollment.create({
          data: {
            schoolId: context.schoolId,
            studentId: student.id,
            academicYearId: input.academicYearId,
            classId: input.classId,
            sectionId: input.sectionId,
            rollNumber: input.rollNumber?.trim() || null,
          },
          include: this.includeRelations(),
        });
        await this.audit.record(
          context,
          {
            action: 'enrollment.created',
            entityType: 'enrollment',
            entityId: enrollment.id,
            newValue: input,
          },
          transaction,
        );
        return enrollment;
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException(
          'This student is already enrolled for the academic year',
        );
      }
      throw error;
    }
  }

  async findMany(
    authUser: SupabaseUser,
    filters: {
      academicYearId?: string;
      classId?: string;
      sectionId?: string;
      studentId?: string;
      status?: string;
    },
  ) {
    const context = await this.access.schoolContext(authUser);
    return this.database.enrollment.findMany({
      where: {
        AND: [
          await this.visibleWhere(context),
          {
            ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
            ...(filters.classId ? { classId: filters.classId } : {}),
            ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
            ...(filters.studentId ? { studentId: filters.studentId } : {}),
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { rollNumber: 'asc' }],
      include: this.includeRelations(),
      take: 1000,
    });
  }

  async findOne(authUser: SupabaseUser, enrollmentId: string) {
    const context = await this.access.schoolContext(authUser);
    const enrollment = await this.database.enrollment.findFirst({
      where: { AND: [{ id: enrollmentId }, await this.visibleWhere(context)] },
      include: this.includeRelations(),
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }
    return enrollment;
  }

  async forStudent(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    return this.database.enrollment.findMany({
      where: { studentId, schoolId: context.schoolId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  async update(
    authUser: SupabaseUser,
    enrollmentId: string,
    input: UpdateEnrollmentDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const existing = await this.scoped(context, enrollmentId);
    const data = {
      rollNumber:
        input.rollNumber === undefined ? undefined : input.rollNumber.trim() || null,
      status: input.status,
    };
    const diff = this.audit.changes(existing, data);
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.enrollment.update({
        where: { id: existing.id },
        data,
        include: this.includeRelations(),
      });
      if (diff.changed) {
        await this.audit.record(
          context,
          {
            action: 'enrollment.updated',
            entityType: 'enrollment',
            entityId: enrollmentId,
            oldValue: diff.oldValue,
            newValue: diff.newValue,
          },
          transaction,
        );
      }
      return updated;
    });
  }

  /** Moves a student to another class or section in the same year (Tier 3). */
  async transfer(authUser: SupabaseUser, enrollmentId: string, input: TransferEnrollmentDto) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.access.assertEnrollmentManageable(context, enrollmentId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Only active enrollments can be transferred');
    }
    const classId = input.classId ?? existing.classId;
    await this.placement(context, {
      academicYearId: existing.academicYearId,
      classId,
      sectionId: input.sectionId,
    });
    if (classId === existing.classId && input.sectionId === existing.sectionId) {
      throw new BadRequestException('The student is already in this class and section');
    }
    const approvalRequest = await this.approvals.create(context, {
      type: TRANSFER,
      entityType: 'enrollment',
      entityId: enrollmentId,
      reason: input.reason,
      payload: { classId, sectionId: input.sectionId },
      tier: 3,
    });
    if (context.isLeader) {
      return this.approvals.approve(context, approvalRequest.id, 'Applied by requester');
    }
    return approvalRequest;
  }

  /** Closes this year's enrollment as PROMOTED and opens the next one. */
  async promote(authUser: SupabaseUser, enrollmentId: string, input: PromoteEnrollmentDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const existing = await this.scoped(context, enrollmentId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Only active enrollments can be promoted');
    }
    if (input.academicYearId === existing.academicYearId) {
      throw new BadRequestException('Promotion must target a different academic year');
    }
    await this.placement(context, input);
    return this.database.$transaction(async (transaction) => {
      await transaction.enrollment.update({
        where: { id: existing.id },
        data: { status: 'PROMOTED' },
      });
      const next = await transaction.enrollment.create({
        data: {
          schoolId: context.schoolId,
          studentId: existing.studentId,
          academicYearId: input.academicYearId,
          classId: input.classId,
          sectionId: input.sectionId,
          rollNumber: input.rollNumber?.trim() || null,
        },
        include: this.includeRelations(),
      });
      await this.audit.record(
        context,
        {
          action: 'enrollment.promoted',
          entityType: 'enrollment',
          entityId: existing.id,
          newValue: { nextEnrollmentId: next.id, ...input },
        },
        transaction,
      );
      return next;
    });
  }

  async withdraw(authUser: SupabaseUser, enrollmentId: string, input: WithdrawEnrollmentDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const existing = await this.scoped(context, enrollmentId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Only active enrollments can be withdrawn');
    }
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.enrollment.update({
        where: { id: existing.id },
        data: { status: 'WITHDRAWN' },
        include: this.includeRelations(),
      });
      await this.audit.record(
        context,
        {
          action: 'enrollment.withdrawn',
          entityType: 'enrollment',
          entityId: existing.id,
          oldValue: { status: existing.status },
          newValue: { status: 'WITHDRAWN' },
          reason: input.reason,
        },
        transaction,
      );
      return updated;
    });
  }

  private async placement(
    context: SchoolContext,
    input: { academicYearId: string; classId: string; sectionId: string },
  ) {
    const [academicYear, schoolClass, section] = await Promise.all([
      this.database.academicYear.findFirst({
        where: { id: input.academicYearId, schoolId: context.schoolId },
      }),
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId: context.schoolId, academicYearId: input.academicYearId },
      }),
      this.database.section.findFirst({
        where: {
          id: input.sectionId,
          schoolId: context.schoolId,
          classId: input.classId,
          academicYearId: input.academicYearId,
          isArchived: false,
        },
      }),
    ]);
    if (!academicYear || !schoolClass || !section) {
      throw new NotFoundException('Academic year, class, or section not found');
    }
    return { academicYear, schoolClass, section };
  }

  private async visibleWhere(context: SchoolContext): Promise<Prisma.EnrollmentWhereInput> {
    if (context.isLeader) {
      return { schoolId: context.schoolId };
    }
    const scope = await this.access.studentScope(context);
    if (scope.all) {
      return { schoolId: context.schoolId };
    }
    const visible: Prisma.EnrollmentWhereInput[] = [{ studentId: { in: scope.ids } }];
    if (context.isTeacher) {
      visible.push(this.access.coverageWhere(await this.access.teacherCoverage(context)));
    }
    return { schoolId: context.schoolId, OR: visible };
  }

  private async scoped(context: SchoolContext, enrollmentId: string) {
    const enrollment = await this.database.enrollment.findFirst({
      where: { id: enrollmentId, schoolId: context.schoolId },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }
    return enrollment;
  }

  private includeRelations() {
    return {
      student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      academicYear: { select: { id: true, name: true, isActive: true } },
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
    };
  }

  private isUniqueError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
