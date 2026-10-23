import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AttendanceRecord, AttendanceStatus, Enrollment, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { NotifyService } from '../../common/notify/notify.service';
import { pageArgs, paged } from '../../common/http/pagination';
import {
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
  BulkAttendanceDto,
  CorrectionRequestDto,
  CreateAttendanceDto,
} from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

/** Teachers may correct a record themselves (Tier 2) within this window; later needs approval. */
const SELF_CORRECTION_WINDOW_MS = 48 * 60 * 60 * 1000;
const CORRECTION = 'attendance.correction';

@Injectable()
export class AttendanceService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalEngine,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(CORRECTION, {
      onApproved: async (transaction, request, approver) => {
        const change = request.payload as { status: AttendanceStatus; remarks?: string };
        const before = await transaction.attendanceRecord.findUniqueOrThrow({
          where: { id: request.entityId },
        });
        await transaction.attendanceRecord.update({
          where: { id: request.entityId },
          data: { status: change.status, remarks: change.remarks ?? before.remarks },
        });
        await this.audit.record(
          approver,
          {
            action: 'attendance.corrected',
            entityType: 'attendance',
            entityId: request.entityId,
            oldValue: { status: before.status, remarks: before.remarks },
            newValue: change,
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
    });
  }

  async create(authUser: SupabaseUser, input: CreateAttendanceDto) {
    const context = await this.access.schoolContext(authUser);
    const enrollment = await this.access.assertEnrollmentManageable(context, input.enrollmentId);
    const date = await this.assertValidDate(enrollment, input.attendanceDate);

    try {
      const record = await this.database.$transaction(async (transaction) => {
        const created = await transaction.attendanceRecord.create({
          data: {
            schoolId: context.schoolId,
            enrollmentId: enrollment.id,
            attendanceDate: date,
            status: input.status,
            remarks: input.remarks?.trim() || null,
            markedById: context.userId,
          },
          include: this.includeRelations(),
        });
        await this.audit.record(
          context,
          {
            action: 'attendance.marked',
            entityType: 'attendance',
            entityId: created.id,
            newValue: { status: created.status, date: input.attendanceDate },
          },
          transaction,
        );
        return created;
      });
      if (input.status === 'ABSENT') {
        await this.notifyAbsent(enrollment.studentId, input.attendanceDate);
      }
      return record;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Attendance already exists for this student and date');
      }
      throw error;
    }
  }

  async bulk(authUser: SupabaseUser, input: BulkAttendanceDto) {
    const context = await this.access.schoolContext(authUser);
    const results: { enrollmentId: string; result: string; id?: string; error?: string }[] = [];
    for (const item of input.records) {
      try {
        const enrollment = await this.access.assertEnrollmentManageable(context, item.enrollmentId);
        const date = await this.assertValidDate(enrollment, input.attendanceDate);
        const existing = await this.database.attendanceRecord.findUnique({
          where: { enrollmentId_attendanceDate: { enrollmentId: enrollment.id, attendanceDate: date } },
        });
        if (!existing) {
          const created = await this.database.attendanceRecord.create({
            data: {
              schoolId: context.schoolId,
              enrollmentId: enrollment.id,
              attendanceDate: date,
              status: item.status,
              remarks: item.remarks?.trim() || null,
              markedById: context.userId,
            },
          });
          await this.audit.record(context, {
            action: 'attendance.marked',
            entityType: 'attendance',
            entityId: created.id,
            newValue: { status: item.status, date: input.attendanceDate },
          });
          if (item.status === 'ABSENT') {
            await this.notifyAbsent(enrollment.studentId, input.attendanceDate);
          }
          results.push({ enrollmentId: item.enrollmentId, result: 'created', id: created.id });
        } else if (existing.status === item.status) {
          results.push({ enrollmentId: item.enrollmentId, result: 'unchanged', id: existing.id });
        } else {
          if (!input.reason) {
            throw new BadRequestException('A reason is required to change saved attendance');
          }
          const updated = await this.applyChange(context, existing, {
            status: item.status,
            remarks: item.remarks,
            reason: input.reason,
          });
          results.push({ enrollmentId: item.enrollmentId, result: 'updated', id: updated.id });
        }
      } catch (error) {
        results.push({
          enrollmentId: item.enrollmentId,
          result: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return {
      attendanceDate: input.attendanceDate,
      created: results.filter((r) => r.result === 'created').length,
      updated: results.filter((r) => r.result === 'updated').length,
      unchanged: results.filter((r) => r.result === 'unchanged').length,
      failed: results.filter((r) => r.result === 'failed').length,
      results,
    };
  }

  async findMany(authUser: SupabaseUser, query: AttendanceQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const where = await this.buildWhere(context, query);
    const [items, total] = await this.database.$transaction([
      this.database.attendanceRecord.findMany({
        where,
        orderBy: [{ attendanceDate: 'desc' }, { createdAt: 'desc' }],
        include: this.includeRelations(),
        ...pageArgs(query),
      }),
      this.database.attendanceRecord.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async findOne(authUser: SupabaseUser, attendanceId: string) {
    const context = await this.access.schoolContext(authUser);
    const record = await this.database.attendanceRecord.findFirst({
      where: { AND: [{ id: attendanceId }, await this.buildWhere(context, {})] },
      include: this.includeRelations(),
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async update(
    authUser: SupabaseUser,
    attendanceId: string,
    input: UpdateAttendanceDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.manageable(context, attendanceId);
    const age = Date.now() - existing.attendanceDate.getTime();
    if (age > SELF_CORRECTION_WINDOW_MS && !context.isLeader) {
      throw new ForbiddenException(
        'Attendance older than 48 hours needs approval; use POST /attendance/:id/correction-request',
      );
    }
    return this.applyChange(context, existing, input);
  }

  async requestCorrection(
    authUser: SupabaseUser,
    attendanceId: string,
    input: CorrectionRequestDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.manageable(context, attendanceId);
    if (context.isLeader) {
      return {
        applied: true,
        record: await this.applyChange(context, existing, input),
      };
    }
    const approvalRequest = await this.approvals.create(context, {
      type: CORRECTION,
      entityType: 'attendance',
      entityId: existing.id,
      reason: input.reason,
      payload: { status: input.status, remarks: input.remarks, previousStatus: existing.status },
      tier: 3,
    });
    return { applied: false, approvalRequest };
  }

  async summary(authUser: SupabaseUser, query: AttendanceSummaryQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const where = await this.buildWhere(context, query);
    const [byStatus, byEnrollment] = await Promise.all([
      this.database.attendanceRecord.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.database.attendanceRecord.groupBy({
        by: ['enrollmentId', 'status'],
        where,
        _count: { _all: true },
      }),
    ]);
    const totals = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
    const recorded = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const attended = (totals.PRESENT ?? 0) + (totals.LATE ?? 0);
    const perEnrollment = new Map<string, Record<string, number>>();
    for (const row of byEnrollment) {
      const entry = perEnrollment.get(row.enrollmentId) ?? {};
      entry[row.status] = row._count._all;
      perEnrollment.set(row.enrollmentId, entry);
    }
    const enrollments = await this.database.enrollment.findMany({
      where: { id: { in: [...perEnrollment.keys()] } },
      select: {
        id: true,
        rollNumber: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      },
    });
    const students = enrollments.map((enrollment) => {
      const counts = perEnrollment.get(enrollment.id) ?? {};
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      const present = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
      return {
        enrollmentId: enrollment.id,
        rollNumber: enrollment.rollNumber,
        student: enrollment.student,
        counts,
        attendanceRate: total ? Math.round((present / total) * 1000) / 10 : null,
      };
    });
    return {
      from: query.from,
      to: query.to,
      totals,
      recorded,
      attendanceRate: recorded ? Math.round((attended / recorded) * 1000) / 10 : null,
      students: students.sort((a, b) => (a.attendanceRate ?? 101) - (b.attendanceRate ?? 101)),
    };
  }

  async exportCsv(authUser: SupabaseUser, query: AttendanceSummaryQueryDto): Promise<string> {
    const context = await this.access.schoolContext(authUser);
    const where = await this.buildWhere(context, query);
    const records = await this.database.attendanceRecord.findMany({
      where,
      orderBy: [{ attendanceDate: 'asc' }],
      take: 50000,
      include: {
        enrollment: {
          include: { student: true, class: true, section: true },
        },
      },
    });
    const rows = [
      ['date', 'admission_no', 'student', 'class', 'section', 'roll_no', 'status', 'remarks'],
      ...records.map((record) => [
        record.attendanceDate.toISOString().slice(0, 10),
        record.enrollment.student.admissionNo,
        `${record.enrollment.student.firstName} ${record.enrollment.student.lastName ?? ''}`.trim(),
        record.enrollment.class.name,
        record.enrollment.section.name,
        record.enrollment.rollNumber ?? '',
        record.status,
        record.remarks ?? '',
      ]),
    ];
    return rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  async forStudent(authUser: SupabaseUser, studentId: string, query: AttendanceQueryDto) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    return this.findMany(authUser, { ...query, studentId });
  }

  async forSection(authUser: SupabaseUser, sectionId: string, query: AttendanceQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const section = await this.database.section.findFirst({
      where: { id: sectionId, schoolId: context.schoolId },
    });
    if (!section) throw new NotFoundException('Section not found');
    if (!context.isLeader) {
      const coverage = await this.access.teacherCoverage(context);
      if (!coverage.sectionIds.includes(sectionId) && !coverage.classIds.includes(section.classId)) {
        throw new ForbiddenException('You are not assigned to this section');
      }
    }
    const date = query.attendanceDate ? new Date(query.attendanceDate) : null;
    const enrollments = await this.database.enrollment.findMany({
      where: { sectionId, schoolId: context.schoolId, status: 'ACTIVE' },
      orderBy: { rollNumber: 'asc' },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        attendance: date
          ? { where: { attendanceDate: date } }
          : { orderBy: { attendanceDate: 'desc' }, take: 1 },
      },
    });
    return enrollments.map((enrollment) => ({
      enrollmentId: enrollment.id,
      rollNumber: enrollment.rollNumber,
      student: enrollment.student,
      attendance: enrollment.attendance[0] ?? null,
    }));
  }

  /** Builds the visible-records filter for the caller plus optional query filters. */
  private async buildWhere(
    context: SchoolContext,
    query: Partial<AttendanceQueryDto>,
  ): Promise<Prisma.AttendanceRecordWhereInput> {
    const enrollment: Prisma.EnrollmentWhereInput = {};
    if (query.sectionId) enrollment.sectionId = query.sectionId;
    if (query.classId) enrollment.classId = query.classId;
    if (query.studentId) enrollment.studentId = query.studentId;

    const scoped: Prisma.EnrollmentWhereInput[] = [enrollment];
    if (!context.isLeader) {
      const scope = await this.access.studentScope(context);
      if (!scope.all) {
        const visible: Prisma.EnrollmentWhereInput[] = [{ studentId: { in: scope.ids } }];
        if (context.isTeacher) {
          visible.push(this.access.coverageWhere(await this.access.teacherCoverage(context)));
        }
        scoped.push({ OR: visible });
      }
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.from) dateFilter.gte = new Date(query.from);
    if (query.to) dateFilter.lte = new Date(query.to);

    return {
      schoolId: context.schoolId,
      enrollment: { AND: scoped },
      ...(query.enrollmentId ? { enrollmentId: query.enrollmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.attendanceDate
        ? { attendanceDate: new Date(query.attendanceDate) }
        : Object.keys(dateFilter).length
          ? { attendanceDate: dateFilter }
          : {}),
    };
  }

  private async manageable(context: SchoolContext, attendanceId: string) {
    const record = await this.database.attendanceRecord.findFirst({
      where: { id: attendanceId, schoolId: context.schoolId },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    await this.access.assertEnrollmentManageable(context, record.enrollmentId);
    return record;
  }

  private async applyChange(
    context: SchoolContext,
    existing: AttendanceRecord,
    input: { status?: AttendanceStatus; remarks?: string; reason: string },
  ) {
    const data = {
      status: input.status,
      remarks: input.remarks === undefined ? undefined : input.remarks.trim() || null,
    };
    const diff = this.audit.changes(existing, data);
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.attendanceRecord.update({
        where: { id: existing.id },
        data: { ...data, markedById: context.userId },
        include: this.includeRelations(),
      });
      await this.audit.record(
        context,
        {
          action: 'attendance.updated',
          entityType: 'attendance',
          entityId: existing.id,
          oldValue: diff.oldValue,
          newValue: diff.newValue,
          reason: input.reason,
        },
        transaction,
      );
      return updated;
    });
  }

  private async assertValidDate(enrollment: Enrollment, value: string): Promise<Date> {
    const date = new Date(value.slice(0, 10));
    if (date.getTime() > Date.now()) {
      throw new BadRequestException('Attendance cannot be marked for a future date');
    }
    if (enrollment.status !== 'ACTIVE') {
      throw new BadRequestException('Attendance can be marked only for active enrollments');
    }
    const year = await this.database.academicYear.findUniqueOrThrow({
      where: { id: enrollment.academicYearId },
    });
    if (date < year.startsOn || date > year.endsOn) {
      throw new BadRequestException('Date is outside the enrollment academic year');
    }
    return date;
  }

  private async notifyAbsent(studentId: string, date: string) {
    await this.notify.toStudentFamily(studentId, {
      type: 'attendance.absent',
      title: 'Marked absent',
      body: `Marked absent on ${date.slice(0, 10)}.`,
      data: { studentId, date },
    });
  }

  private includeRelations() {
    return {
      enrollment: {
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
        },
      },
      markedBy: { select: { id: true, displayName: true } },
    };
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
