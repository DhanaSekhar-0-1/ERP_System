import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffLeave, StudentLeave } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotifyService } from '../../common/notify/notify.service';
import { ROLE } from '../../common/access/roles';
import {
  CreateStaffLeaveDto,
  CreateStudentLeaveDto,
  LeaveQueryDto,
  UpdateEntitlementsDto,
  UpdateLeaveDto,
} from './dto/leaves.dto';

const DAY_MS = 86_400_000;

/** School days between two dates, inclusive; Sundays are skipped. */
export function schoolDays(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let time = from.getTime(); time <= to.getTime(); time += DAY_MS) {
    const day = new Date(time);
    if (day.getUTCDay() !== 0) days.push(day);
  }
  return days;
}

/** ISO weekday: Monday = 1 ... Sunday = 7, matching timetable day numbers. */
export function isoWeekday(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

@Injectable()
export class LeavesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  // ---------- Student leave ----------

  async createStudentLeave(authUser: SupabaseUser, input: CreateStudentLeaveDto) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, input.studentId);
    if (!context.isLeader && context.studentId !== input.studentId && !context.guardianId) {
      throw new ForbiddenException('Only the student, a parent, or the school can request leave');
    }
    const { from, to } = this.range(input.fromDate, input.toDate);
    const overlap = await this.database.studentLeave.findFirst({
      where: {
        studentId: input.studentId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
    });
    if (overlap) throw new ConflictException('A leave request already covers these dates');
    const leave = await this.database.studentLeave.create({
      data: {
        schoolId: context.schoolId,
        studentId: input.studentId,
        fromDate: from,
        toDate: to,
        reason: input.reason.trim(),
        requestedById: context.userId,
      },
      include: this.studentInclude(),
    });
    const classTeachers = await this.classTeacherUserIds(input.studentId);
    await this.notify.toUsers(classTeachers, {
      type: 'leave.requested',
      title: 'Leave request',
      body: `${leave.student.firstName} requested leave ${input.fromDate.slice(0, 10)} to ${input.toDate.slice(0, 10)}`,
      schoolId: context.schoolId,
      data: { studentLeaveId: leave.id },
    });
    return leave;
  }

  async findStudentLeaves(authUser: SupabaseUser, query: LeaveQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.studentLeave.findMany({
      where: {
        AND: [
          await this.studentLeaveVisibility(context),
          {
            ...(query.status ? { status: query.status } : {}),
            ...(query.studentId ? { studentId: query.studentId } : {}),
          },
        ],
      },
      orderBy: { fromDate: 'desc' },
      include: this.studentInclude(),
      take: 500,
    });
  }

  async findStudentLeave(authUser: SupabaseUser, leaveId: string) {
    const context = await this.access.schoolContext(authUser);
    const leave = await this.database.studentLeave.findFirst({
      where: { AND: [{ id: leaveId }, await this.studentLeaveVisibility(context)] },
      include: this.studentInclude(),
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    return leave;
  }

  async updateStudentLeave(authUser: SupabaseUser, leaveId: string, input: UpdateLeaveDto) {
    const context = await this.access.schoolContext(authUser);
    const leave = await this.findStudentLeave(authUser, leaveId);
    this.assertPendingRequester(context, leave);
    const { from, to } = this.range(
      input.fromDate ?? leave.fromDate.toISOString(),
      input.toDate ?? leave.toDate.toISOString(),
    );
    return this.database.studentLeave.update({
      where: { id: leave.id },
      data: { fromDate: from, toDate: to, reason: input.reason?.trim() },
      include: this.studentInclude(),
    });
  }

  /** Approval marks every school day in the range ON_LEAVE (distinct from ABSENT). */
  async decideStudentLeave(
    authUser: SupabaseUser,
    leaveId: string,
    decision: 'APPROVED' | 'REJECTED',
    note?: string,
  ) {
    const context = await this.access.schoolContext(authUser);
    const leave = await this.findStudentLeave(authUser, leaveId);
    if (leave.status !== 'PENDING') {
      throw new ConflictException(`Leave request is already ${leave.status.toLowerCase()}`);
    }
    if (!context.isLeader) {
      const classTeachers = await this.classTeacherUserIds(leave.studentId);
      if (!classTeachers.includes(context.userId)) {
        throw new ForbiddenException('Only the class teacher or school leadership can decide this leave');
      }
    }
    const result = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.studentLeave.update({
        where: { id: leave.id },
        data: { status: decision, decidedById: context.userId, decisionNote: note, decidedAt: new Date() },
        include: this.studentInclude(),
      });
      let markedDays = 0;
      if (decision === 'APPROVED') {
        markedDays = await this.markOnLeave(transaction, context, leave);
      }
      await this.audit.record(
        context,
        {
          action: `student-leave.${decision.toLowerCase()}`,
          entityType: 'student-leave',
          entityId: leave.id,
          reason: note,
          metadata: { markedDays },
        },
        transaction,
      );
      return { ...updated, markedDays };
    });
    await this.notify.toStudentFamily(leave.studentId, {
      type: `leave.${decision.toLowerCase()}`,
      title: decision === 'APPROVED' ? 'Leave approved' : 'Leave rejected',
      body: note ?? `Leave from ${leave.fromDate.toISOString().slice(0, 10)} was ${decision.toLowerCase()}.`,
      data: { studentLeaveId: leave.id },
    });
    return result;
  }

  async cancelStudentLeave(authUser: SupabaseUser, leaveId: string) {
    const context = await this.access.schoolContext(authUser);
    const leave = await this.findStudentLeave(authUser, leaveId);
    if (!['PENDING', 'APPROVED'].includes(leave.status)) {
      throw new ConflictException(`Leave request is already ${leave.status.toLowerCase()}`);
    }
    if (leave.requestedById !== context.userId && !context.isLeader) {
      throw new ForbiddenException('Only the requester can cancel this leave');
    }
    return this.database.$transaction(async (transaction) => {
      if (leave.status === 'APPROVED') {
        const today = new Date(new Date().toISOString().slice(0, 10));
        await transaction.attendanceRecord.deleteMany({
          where: {
            source: 'LEAVE',
            status: 'ON_LEAVE',
            enrollment: { studentId: leave.studentId },
            attendanceDate: { gte: today > leave.fromDate ? today : leave.fromDate, lte: leave.toDate },
          },
        });
      }
      await this.audit.record(
        context,
        { action: 'student-leave.cancelled', entityType: 'student-leave', entityId: leave.id },
        transaction,
      );
      return transaction.studentLeave.update({
        where: { id: leave.id },
        data: { status: 'CANCELLED' },
        include: this.studentInclude(),
      });
    });
  }

  // ---------- Staff leave ----------

  async createStaffLeave(authUser: SupabaseUser, input: CreateStaffLeaveDto) {
    const context = await this.access.schoolContext(authUser);
    if (!context.staffId) {
      throw new ForbiddenException('Only staff members can request staff leave');
    }
    const { from, to } = this.range(input.fromDate, input.toDate);
    const days = schoolDays(from, to).length;
    if (!days) throw new BadRequestException('The range has no school days');
    const overlap = await this.database.staffLeave.findFirst({
      where: {
        staffId: context.staffId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
    });
    if (overlap) throw new ConflictException('A leave request already covers these dates');
    if (input.leaveType !== 'UNPAID') {
      const balance = await this.balanceFor(context.schoolId, context.staffId, from);
      const remaining = balance.find((row) => row.leaveType === input.leaveType)?.remaining ?? 0;
      if (days > remaining) {
        throw new BadRequestException(
          `Only ${remaining} ${input.leaveType.toLowerCase()} leave days remain`,
        );
      }
    }
    const leave = await this.database.staffLeave.create({
      data: {
        schoolId: context.schoolId,
        staffId: context.staffId,
        leaveType: input.leaveType,
        fromDate: from,
        toDate: to,
        days,
        reason: input.reason.trim(),
      },
      include: this.staffInclude(),
    });
    await this.notify.toRoles(context.schoolId, [ROLE.PRINCIPAL, ROLE.SCHOOL_ADMIN], {
      type: 'staff-leave.requested',
      title: 'Staff leave request',
      body: `${context.displayName} requested ${days} day(s) ${input.leaveType.toLowerCase()} leave`,
      data: { staffLeaveId: leave.id },
    });
    return leave;
  }

  async findStaffLeaves(authUser: SupabaseUser, query: LeaveQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.staffLeave.findMany({
      where: {
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { staffId: context.staffId ?? '00000000-0000-0000-0000-000000000000' }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.staffId ? { staffId: query.staffId } : {}),
      },
      orderBy: { fromDate: 'desc' },
      include: this.staffInclude(),
      take: 500,
    });
  }

  async findStaffLeave(authUser: SupabaseUser, leaveId: string) {
    const context = await this.access.schoolContext(authUser);
    const leave = await this.database.staffLeave.findFirst({
      where: {
        id: leaveId,
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { staffId: context.staffId ?? '00000000-0000-0000-0000-000000000000' }),
      },
      include: { ...this.staffInclude(), substitutes: true },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    return leave;
  }

  /** Approval opens a substitute request for each timetabled period the teacher will miss. */
  async decideStaffLeave(
    authUser: SupabaseUser,
    leaveId: string,
    decision: 'APPROVED' | 'REJECTED',
    note?: string,
  ) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context, 'Only the Principal or School Admin can decide staff leave');
    const leave = await this.findStaffLeave(authUser, leaveId);
    if (leave.status !== 'PENDING') {
      throw new ConflictException(`Leave request is already ${leave.status.toLowerCase()}`);
    }
    if (leave.staffId === context.staffId) {
      throw new ForbiddenException('You cannot decide your own leave');
    }
    const result = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.staffLeave.update({
        where: { id: leave.id },
        data: { status: decision, decidedById: context.userId, decisionNote: note, decidedAt: new Date() },
        include: this.staffInclude(),
      });
      let substitutesOpened = 0;
      if (decision === 'APPROVED') {
        substitutesOpened = await this.openSubstitutes(transaction, leave);
      }
      await this.audit.record(
        context,
        {
          action: `staff-leave.${decision.toLowerCase()}`,
          entityType: 'staff-leave',
          entityId: leave.id,
          reason: note,
          metadata: { substitutesOpened },
        },
        transaction,
      );
      return { ...updated, substitutesOpened };
    });
    await this.notify.toUsers([leave.staff.user.id], {
      type: `staff-leave.${decision.toLowerCase()}`,
      title: decision === 'APPROVED' ? 'Leave approved' : 'Leave rejected',
      body: note ?? `Your leave from ${leave.fromDate.toISOString().slice(0, 10)} was ${decision.toLowerCase()}.`,
      schoolId: context.schoolId,
      data: { staffLeaveId: leave.id },
    });
    return result;
  }

  async cancelStaffLeave(authUser: SupabaseUser, leaveId: string) {
    const context = await this.access.schoolContext(authUser);
    const leave = await this.findStaffLeave(authUser, leaveId);
    if (!['PENDING', 'APPROVED'].includes(leave.status)) {
      throw new ConflictException(`Leave request is already ${leave.status.toLowerCase()}`);
    }
    if (leave.staffId !== context.staffId && !context.isLeader) {
      throw new ForbiddenException('Only the requester can cancel this leave');
    }
    return this.database.$transaction(async (transaction) => {
      await transaction.substituteRequest.updateMany({
        where: { staffLeaveId: leave.id, status: { in: ['OPEN', 'ASSIGNED'] } },
        data: { status: 'CANCELLED' },
      });
      await this.audit.record(
        context,
        { action: 'staff-leave.cancelled', entityType: 'staff-leave', entityId: leave.id },
        transaction,
      );
      return transaction.staffLeave.update({
        where: { id: leave.id },
        data: { status: 'CANCELLED' },
        include: this.staffInclude(),
      });
    });
  }

  async leaveBalance(authUser: SupabaseUser, staffId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && context.staffId !== staffId) {
      throw new ForbiddenException('You can view only your own leave balance');
    }
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');
    return this.balanceFor(context.schoolId, staffId, new Date());
  }

  async updateEntitlements(authUser: SupabaseUser, staffId: string, input: UpdateEntitlementsDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');
    for (const entitlement of input.entitlements) {
      await this.database.leaveEntitlement.upsert({
        where: {
          staffId_academicYearId_leaveType: {
            staffId,
            academicYearId: input.academicYearId,
            leaveType: entitlement.leaveType,
          },
        },
        create: {
          staffId,
          academicYearId: input.academicYearId,
          leaveType: entitlement.leaveType,
          days: entitlement.days,
        },
        update: { days: entitlement.days },
      });
    }
    await this.audit.record(context, {
      action: 'leave-entitlements.updated',
      entityType: 'staff',
      entityId: staffId,
      newValue: input,
    });
    return this.balanceFor(context.schoolId, staffId, new Date());
  }

  // ---------- Helpers ----------

  private async balanceFor(schoolId: string, staffId: string, onDate: Date) {
    const covering = { schoolId, startsOn: { lte: onDate }, endsOn: { gte: onDate } };
    const year =
      (await this.database.academicYear.findFirst({ where: { ...covering, isActive: true } })) ??
      (await this.database.academicYear.findFirst({
        where: { ...covering, isClosed: false },
        orderBy: { startsOn: 'desc' },
      })) ??
      (await this.database.academicYear.findFirst({ where: { schoolId, isActive: true } }));
    if (!year) return [];
    const [entitlements, used] = await Promise.all([
      this.database.leaveEntitlement.findMany({ where: { staffId, academicYearId: year.id } }),
      this.database.staffLeave.groupBy({
        by: ['leaveType'],
        where: {
          staffId,
          status: { in: ['APPROVED', 'PENDING'] },
          fromDate: { gte: year.startsOn },
          toDate: { lte: year.endsOn },
        },
        _sum: { days: true },
      }),
    ]);
    const usedByType = new Map(used.map((row) => [row.leaveType, row._sum.days ?? 0]));
    return (['CASUAL', 'SICK', 'EARNED'] as const).map((leaveType) => {
      const entitled = entitlements.find((row) => row.leaveType === leaveType)?.days ?? 0;
      const taken = usedByType.get(leaveType) ?? 0;
      return { academicYearId: year.id, leaveType, entitled, used: taken, remaining: Math.max(entitled - taken, 0) };
    });
  }

  private async markOnLeave(
    transaction: Prisma.TransactionClient,
    context: SchoolContext,
    leave: StudentLeave,
  ): Promise<number> {
    let marked = 0;
    for (const day of schoolDays(leave.fromDate, leave.toDate)) {
      const enrollment = await transaction.enrollment.findFirst({
        where: {
          studentId: leave.studentId,
          status: 'ACTIVE',
          academicYear: { startsOn: { lte: day }, endsOn: { gte: day } },
        },
      });
      if (!enrollment) continue;
      const existing = await transaction.attendanceRecord.findUnique({
        where: { enrollmentId_attendanceDate: { enrollmentId: enrollment.id, attendanceDate: day } },
      });
      if (existing && existing.status !== 'ABSENT') continue;
      await transaction.attendanceRecord.upsert({
        where: { enrollmentId_attendanceDate: { enrollmentId: enrollment.id, attendanceDate: day } },
        create: {
          schoolId: context.schoolId,
          enrollmentId: enrollment.id,
          attendanceDate: day,
          status: 'ON_LEAVE',
          remarks: `Approved leave: ${leave.reason}`,
          markedById: context.userId,
          source: 'LEAVE',
        },
        update: { status: 'ON_LEAVE', source: 'LEAVE', remarks: `Approved leave: ${leave.reason}` },
      });
      marked += 1;
    }
    return marked;
  }

  private async openSubstitutes(transaction: Prisma.TransactionClient, leave: StaffLeave): Promise<number> {
    const slots = await transaction.timetableSlot.findMany({
      where: { staffId: leave.staffId, timetable: { status: { in: ['PUBLISHED', 'LOCKED'] } } },
    });
    let opened = 0;
    for (const day of schoolDays(leave.fromDate, leave.toDate)) {
      for (const slot of slots.filter((entry) => entry.dayOfWeek === isoWeekday(day))) {
        await transaction.substituteRequest.upsert({
          where: { slotId_date: { slotId: slot.id, date: day } },
          create: {
            schoolId: leave.schoolId,
            date: day,
            slotId: slot.id,
            originalStaffId: leave.staffId,
            staffLeaveId: leave.id,
            reason: `Staff leave: ${leave.reason}`,
          },
          update: {},
        });
        opened += 1;
      }
    }
    return opened;
  }

  private async classTeacherUserIds(studentId: string): Promise<string[]> {
    const enrollment = await this.database.enrollment.findFirst({
      where: { studentId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!enrollment) return [];
    const assignments = await this.database.staffAssignment.findMany({
      where: {
        academicYearId: enrollment.academicYearId,
        classId: enrollment.classId,
        isClassTeacher: true,
        OR: [{ sectionId: null }, { sectionId: enrollment.sectionId }],
      },
      select: { staff: { select: { userId: true } } },
    });
    return assignments.map((assignment) => assignment.staff.userId);
  }

  private async studentLeaveVisibility(context: SchoolContext): Promise<Prisma.StudentLeaveWhereInput> {
    if (context.isLeader) return { schoolId: context.schoolId };
    const scope = await this.access.studentScope(context);
    return { schoolId: context.schoolId, studentId: { in: scope.all ? [] : scope.ids } };
  }

  private assertPendingRequester(context: SchoolContext, leave: { status: string; requestedById: string }) {
    if (leave.status !== 'PENDING') {
      throw new ConflictException('Only pending requests can be changed');
    }
    if (leave.requestedById !== context.userId) {
      throw new ForbiddenException('Only the requester can change this request');
    }
  }

  private range(fromValue: string, toValue: string) {
    const from = new Date(fromValue.slice(0, 10));
    const to = new Date(toValue.slice(0, 10));
    if (from > to) throw new BadRequestException('Leave must end on or after its start date');
    return { from, to };
  }

  private studentInclude() {
    return {
      student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
    };
  }

  private staffInclude() {
    return {
      staff: {
        select: {
          id: true,
          employeeNo: true,
          user: { select: { id: true, displayName: true } },
        },
      },
    };
  }
}
