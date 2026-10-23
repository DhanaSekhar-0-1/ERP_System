import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { isoWeekday } from '../leaves/leaves.service';

const DAY_MS = 86_400_000;

function today(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Dashboards, reports, and analytics are read-only aggregates over the operational tables. */
@Injectable()
export class InsightsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
  ) {}

  // ---------- Dashboards ----------

  async principal(authUser: SupabaseUser) {
    const context = await this.leader(authUser);
    const schoolId = context.schoolId;
    const date = today();
    const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const [students, staff, attendanceToday, staffOnLeave, approvals, collections, exams, complaints, leaves] =
      await Promise.all([
        this.database.student.count({ where: { schoolId, isArchived: false } }),
        this.database.staffProfile.count({ where: { schoolId, user: { status: 'ACTIVE' } } }),
        this.database.attendanceRecord.groupBy({
          by: ['status'],
          where: { schoolId, attendanceDate: date },
          _count: { _all: true },
        }),
        this.database.staffLeave.count({
          where: { schoolId, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } },
        }),
        this.database.approvalRequest.count({ where: { schoolId, status: 'PENDING' } }),
        this.database.payment.aggregate({
          where: { schoolId, status: 'VERIFIED', paidAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        this.database.examination.groupBy({ by: ['status'], where: { schoolId }, _count: { _all: true } }),
        this.database.complaint.groupBy({
          by: ['status'],
          where: { schoolId, status: { not: 'RESOLVED' } },
          _count: { _all: true },
        }),
        this.database.studentLeave.count({ where: { schoolId, status: 'PENDING' } }),
      ]);
    const attendance = Object.fromEntries(attendanceToday.map((row) => [row.status, row._count._all]));
    const marked = Object.values(attendance).reduce((sum, value) => sum + value, 0);
    return {
      date,
      students,
      activeStaff: staff,
      attendanceToday: {
        ...attendance,
        marked,
        rate: marked ? round((((attendance.PRESENT ?? 0) + (attendance.LATE ?? 0)) / marked) * 100) : null,
      },
      staffOnLeaveToday: staffOnLeave,
      pendingApprovals: approvals,
      pendingStudentLeaves: leaves,
      feeCollectionThisMonth: Number(collections._sum.amount ?? 0),
      examinations: Object.fromEntries(exams.map((row) => [row.status, row._count._all])),
      openComplaints: Object.fromEntries(complaints.map((row) => [row.status, row._count._all])),
    };
  }

  async teacher(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.staffId) throw new ForbiddenException('A staff profile is required');
    return this.teacherSummary(context, context.staffId);
  }

  async teacherToday(authUser: SupabaseUser, staffId: string) {
    const context = await this.selfOrLeader(authUser, staffId);
    const date = today();
    const [slots, substitutes] = await Promise.all([
      this.database.timetableSlot.findMany({
        where: {
          staffId,
          dayOfWeek: isoWeekday(date),
          timetable: { status: { in: ['PUBLISHED', 'LOCKED'] }, academicYear: { isActive: true } },
        },
        orderBy: { periodNo: 'asc' },
        include: {
          subject: { select: { name: true } },
          timetable: { select: { section: { select: { id: true, name: true, class: { select: { name: true } } } } } },
        },
      }),
      this.database.substituteRequest.findMany({
        where: { schoolId: context.schoolId, date, substituteStaffId: staffId, status: 'ASSIGNED' },
        include: { slot: { include: { subject: { select: { name: true } } } } },
      }),
    ]);
    const onLeave = await this.database.staffLeave.findFirst({
      where: { staffId, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } },
    });
    return {
      date,
      onLeave: Boolean(onLeave),
      periods: slots.map((slot) => ({
        periodNo: slot.periodNo,
        subject: slot.subject.name,
        section: slot.timetable.section,
        room: slot.room,
      })),
      substituteDuties: substitutes.map((request) => ({
        periodNo: request.slot.periodNo,
        subject: request.slot.subject.name,
        requestId: request.id,
      })),
    };
  }

  async teacherPendingWork(authUser: SupabaseUser, staffId: string) {
    const context = await this.selfOrLeader(authUser, staffId);
    return this.pendingWork(context, staffId);
  }

  async parent(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.guardianId) throw new ForbiddenException('A linked parent account is required');
    return this.childrenSummary(context, context.guardianId);
  }

  async parentChildren(authUser: SupabaseUser, guardianId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && context.guardianId !== guardianId) {
      throw new ForbiddenException('You can view only your own children');
    }
    return this.childrenSummary(context, guardianId);
  }

  async accountant(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isAccountant && !context.isLeader) {
      throw new ForbiddenException('Accountant access is required');
    }
    const schoolId = context.schoolId;
    const date = today();
    const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const [collectedToday, collectedMonth, overdue, pendingVerification, refunds, outstanding] = await Promise.all([
      this.database.payment.aggregate({
        where: { schoolId, status: 'VERIFIED', paidAt: { gte: date } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.database.payment.aggregate({
        where: { schoolId, status: 'VERIFIED', paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.database.studentFee.findMany({
        where: { schoolId, status: { in: ['PENDING', 'PARTIAL'] }, dueDate: { lt: date } },
        select: { totalAmount: true, discountAmount: true, paidAmount: true },
      }),
      this.database.payment.count({ where: { schoolId, status: 'PENDING' } }),
      this.database.payment.count({ where: { schoolId, status: 'REFUND_REQUESTED' } }),
      this.database.studentFee.aggregate({
        where: { schoolId, status: { in: ['PENDING', 'PARTIAL'] } },
        _sum: { totalAmount: true, discountAmount: true, paidAmount: true },
      }),
    ]);
    return {
      date,
      collectedToday: Number(collectedToday._sum.amount ?? 0),
      paymentsToday: collectedToday._count._all,
      collectedThisMonth: Number(collectedMonth._sum.amount ?? 0),
      overdueAccounts: overdue.length,
      overdueAmount: overdue.reduce(
        (sum, fee) => sum + Number(fee.totalAmount) - Number(fee.discountAmount) - Number(fee.paidAmount),
        0,
      ),
      outstandingAmount:
        Number(outstanding._sum.totalAmount ?? 0) -
        Number(outstanding._sum.discountAmount ?? 0) -
        Number(outstanding._sum.paidAmount ?? 0),
      paymentsAwaitingVerification: pendingVerification,
      refundRequests: refunds,
    };
  }

  // ---------- Reports ----------

  async attendanceReport(authUser: SupabaseUser, from: string, to: string) {
    const context = await this.leader(authUser);
    const rows = await this.database.attendanceRecord.groupBy({
      by: ['enrollmentId', 'status'],
      where: { schoolId: context.schoolId, attendanceDate: { gte: new Date(from), lte: new Date(to) } },
      _count: { _all: true },
    });
    const enrollments = await this.database.enrollment.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.enrollmentId))] } },
      select: { id: true, sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } },
    });
    const sectionOf = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
    const bySection = new Map<string, { label: string; counts: Record<string, number> }>();
    for (const row of rows) {
      const enrollment = sectionOf.get(row.enrollmentId);
      if (!enrollment) continue;
      const entry = bySection.get(enrollment.sectionId) ?? {
        label: `${enrollment.section.class.name} - ${enrollment.section.name}`,
        counts: {},
      };
      entry.counts[row.status] = (entry.counts[row.status] ?? 0) + row._count._all;
      bySection.set(enrollment.sectionId, entry);
    }
    return {
      from,
      to,
      sections: [...bySection.entries()].map(([sectionId, entry]) => {
        const total = Object.values(entry.counts).reduce((sum, value) => sum + value, 0);
        const present = (entry.counts.PRESENT ?? 0) + (entry.counts.LATE ?? 0);
        return { sectionId, section: entry.label, ...entry.counts, total, rate: total ? round((present / total) * 100) : null };
      }),
    };
  }

  async examinationStatusReport(authUser: SupabaseUser) {
    const context = await this.leader(authUser);
    const exams = await this.database.examination.findMany({
      where: { schoolId: context.schoolId },
      orderBy: { createdAt: 'desc' },
      include: {
        assessments: { select: { id: true, marks: { select: { status: true } } } },
      },
    });
    return exams.map((exam) => {
      const marks = exam.assessments.flatMap((assessment) => assessment.marks);
      return {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        assessments: exam.assessments.length,
        marksEntered: marks.length,
        marksSubmitted: marks.filter((mark) => mark.status === 'SUBMITTED').length,
        releasedAt: exam.releasedAt,
      };
    });
  }

  async pendingApprovalsReport(authUser: SupabaseUser) {
    const context = await this.leader(authUser);
    const pending = await this.database.approvalRequest.findMany({
      where: { schoolId: context.schoolId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, tier: true, createdAt: true, reason: true },
    });
    const byType: Record<string, number> = {};
    pending.forEach((request) => {
      byType[request.type] = (byType[request.type] ?? 0) + 1;
    });
    return {
      total: pending.length,
      byType,
      oldest: pending.slice(0, 10).map((request) => ({
        ...request,
        ageDays: Math.floor((Date.now() - request.createdAt.getTime()) / DAY_MS),
      })),
    };
  }

  async complaintReport(authUser: SupabaseUser) {
    const context = await this.leader(authUser);
    const complaints = await this.database.complaint.findMany({
      where: { schoolId: context.schoolId },
      select: { status: true, category: true, createdAt: true, updatedAt: true },
    });
    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let resolvedDays = 0;
    let resolvedCount = 0;
    for (const complaint of complaints) {
      byStatus[complaint.status] = (byStatus[complaint.status] ?? 0) + 1;
      byCategory[complaint.category] = (byCategory[complaint.category] ?? 0) + 1;
      if (complaint.status === 'RESOLVED') {
        resolvedDays += (complaint.updatedAt.getTime() - complaint.createdAt.getTime()) / DAY_MS;
        resolvedCount += 1;
      }
    }
    return {
      total: complaints.length,
      byStatus,
      byCategory,
      averageResolutionDays: resolvedCount ? round(resolvedDays / resolvedCount) : null,
    };
  }

  async collectionsReport(authUser: SupabaseUser, from: string, to: string) {
    const context = await this.finance(authUser);
    const payments = await this.database.payment.findMany({
      where: {
        schoolId: context.schoolId,
        status: 'VERIFIED',
        paidAt: { gte: new Date(from), lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`) },
      },
      select: { amount: true, paidAt: true, method: true },
    });
    const byDay = new Map<string, number>();
    for (const payment of payments) {
      const day = (payment.paidAt as Date).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(payment.amount));
    }
    return {
      from,
      to,
      total: payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
      payments: payments.length,
      daily: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
    };
  }

  async reconciliationReport(authUser: SupabaseUser, from: string, to: string) {
    const context = await this.finance(authUser);
    const range = { gte: new Date(from), lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`) };
    const [byStatus, staleOrders, unprocessed] = await Promise.all([
      this.database.payment.groupBy({
        by: ['status', 'method'],
        where: { schoolId: context.schoolId, createdAt: range },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.database.payment.findMany({
        where: {
          schoolId: context.schoolId,
          method: 'ONLINE',
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - DAY_MS) },
        },
        select: { id: true, gatewayOrderId: true, amount: true, createdAt: true },
      }),
      this.database.paymentWebhookEvent.count({ where: { processedAt: null } }),
    ]);
    return {
      from,
      to,
      payments: byStatus.map((row) => ({
        status: row.status,
        method: row.method,
        count: row._count._all,
        amount: Number(row._sum.amount ?? 0),
      })),
      staleOnlineOrders: staleOrders,
      unprocessedWebhookEvents: unprocessed,
    };
  }

  // ---------- Analytics ----------

  async attendanceTrend(authUser: SupabaseUser, from: string, to: string) {
    const context = await this.leader(authUser);
    const records = await this.database.attendanceRecord.findMany({
      where: { schoolId: context.schoolId, attendanceDate: { gte: new Date(from), lte: new Date(to) } },
      select: { attendanceDate: true, status: true },
    });
    const byWeek = new Map<string, { total: number; present: number }>();
    for (const record of records) {
      const date = record.attendanceDate;
      const monday = new Date(date.getTime() - (isoWeekday(date) - 1) * DAY_MS).toISOString().slice(0, 10);
      const entry = byWeek.get(monday) ?? { total: 0, present: 0 };
      entry.total += 1;
      if (record.status === 'PRESENT' || record.status === 'LATE') entry.present += 1;
      byWeek.set(monday, entry);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekOf, entry]) => ({ weekOf, ...entry, rate: round((entry.present / entry.total) * 100) }));
  }

  async academicPerformance(authUser: SupabaseUser, examinationId?: string) {
    const context = await this.leader(authUser);
    const marks = await this.database.mark.findMany({
      where: {
        schoolId: context.schoolId,
        isAbsent: false,
        assessment: {
          examination: { status: 'RELEASED', ...(examinationId ? { id: examinationId } : {}) },
        },
      },
      select: {
        marksObtained: true,
        assessment: {
          select: {
            maxMarks: true,
            subject: { select: { name: true } },
            class: { select: { name: true } },
            examination: { select: { name: true } },
          },
        },
      },
    });
    const groups = new Map<string, { sum: number; count: number; label: Record<string, string> }>();
    for (const mark of marks) {
      const { assessment } = mark;
      const key = `${assessment.examination.name}|${assessment.class.name}|${assessment.subject.name}`;
      const entry = groups.get(key) ?? {
        sum: 0,
        count: 0,
        label: { examination: assessment.examination.name, class: assessment.class.name, subject: assessment.subject.name },
      };
      entry.sum += (Number(mark.marksObtained ?? 0) / Number(assessment.maxMarks)) * 100;
      entry.count += 1;
      groups.set(key, entry);
    }
    return [...groups.values()].map((entry) => ({
      ...entry.label,
      students: entry.count,
      averagePercent: round(entry.sum / entry.count),
    }));
  }

  async feeCollectionTrend(authUser: SupabaseUser) {
    const context = await this.finance(authUser);
    const since = new Date(Date.now() - 365 * DAY_MS);
    const payments = await this.database.payment.findMany({
      where: { schoolId: context.schoolId, status: 'VERIFIED', paidAt: { gte: since } },
      select: { amount: true, paidAt: true },
    });
    const byMonth = new Map<string, number>();
    for (const payment of payments) {
      const month = (payment.paidAt as Date).toISOString().slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + Number(payment.amount));
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
  }

  async teacherWorkload(authUser: SupabaseUser) {
    const context = await this.leader(authUser);
    const staff = await this.database.staffProfile.findMany({
      where: { schoolId: context.schoolId, user: { status: 'ACTIVE' } },
      select: {
        id: true,
        user: { select: { displayName: true } },
        _count: {
          select: { timetableSlots: true, homework: true, substituteAssigned: true, staffAssignments: true },
        },
      },
    });
    return staff
      .map((member) => ({
        staffId: member.id,
        name: member.user.displayName,
        periodsPerWeek: member._count.timetableSlots,
        assignments: member._count.staffAssignments,
        homeworkSet: member._count.homework,
        substitutions: member._count.substituteAssigned,
      }))
      .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);
  }

  async complaintTrend(authUser: SupabaseUser) {
    const context = await this.leader(authUser);
    const complaints = await this.database.complaint.findMany({
      where: { schoolId: context.schoolId },
      select: { createdAt: true, category: true },
    });
    const byMonth = new Map<string, Record<string, number>>();
    for (const complaint of complaints) {
      const month = complaint.createdAt.toISOString().slice(0, 7);
      const entry = byMonth.get(month) ?? {};
      entry[complaint.category] = (entry[complaint.category] ?? 0) + 1;
      byMonth.set(month, entry);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, categories]) => ({ month, categories }));
  }

  /** Rule-based flag (not predictive): students under 75% attendance in the last 60 days. */
  async attendanceRisk(authUser: SupabaseUser, threshold = 75) {
    const context = await this.leader(authUser);
    const since = new Date(Date.now() - 60 * DAY_MS);
    const rows = await this.database.attendanceRecord.groupBy({
      by: ['enrollmentId', 'status'],
      where: { schoolId: context.schoolId, attendanceDate: { gte: since } },
      _count: { _all: true },
    });
    const totals = new Map<string, { total: number; present: number }>();
    for (const row of rows) {
      const entry = totals.get(row.enrollmentId) ?? { total: 0, present: 0 };
      entry.total += row._count._all;
      if (row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'ON_LEAVE' || row.status === 'EXCUSED') {
        entry.present += row._count._all;
      }
      totals.set(row.enrollmentId, entry);
    }
    const atRisk = [...totals.entries()]
      .map(([enrollmentId, entry]) => ({ enrollmentId, ...entry, rate: round((entry.present / entry.total) * 100) }))
      .filter((entry) => entry.total >= 5 && entry.rate < threshold);
    const enrollments = await this.database.enrollment.findMany({
      where: { id: { in: atRisk.map((entry) => entry.enrollmentId) } },
      select: {
        id: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
      },
    });
    const byId = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
    return {
      since,
      threshold,
      students: atRisk
        .map((entry) => ({ ...entry, ...byId.get(entry.enrollmentId) }))
        .sort((a, b) => a.rate - b.rate),
    };
  }

  // ---------- Helpers ----------

  private async teacherSummary(context: SchoolContext, staffId: string) {
    const [todayPlan, pending, leaves, unread] = await Promise.all([
      this.teacherTodayInternal(context, staffId),
      this.pendingWork(context, staffId),
      this.database.staffLeave.findMany({
        where: { staffId, status: { in: ['PENDING', 'APPROVED'] }, toDate: { gte: today() } },
        orderBy: { fromDate: 'asc' },
      }),
      this.database.notification.count({ where: { userId: context.userId, readAt: null } }),
    ]);
    return { today: todayPlan, pendingWork: pending, upcomingLeave: leaves, unreadNotifications: unread };
  }

  private async teacherTodayInternal(context: SchoolContext, staffId: string) {
    const slots = await this.database.timetableSlot.count({
      where: { staffId, dayOfWeek: isoWeekday(today()), timetable: { status: { in: ['PUBLISHED', 'LOCKED'] } } },
    });
    const substitutes = await this.database.substituteRequest.count({
      where: { schoolId: context.schoolId, date: today(), substituteStaffId: staffId, status: 'ASSIGNED' },
    });
    return { periods: slots, substituteDuties: substitutes };
  }

  private async pendingWork(context: SchoolContext, staffId: string) {
    const date = today();
    const assignments = await this.database.staffAssignment.findMany({
      where: { staffId, academicYear: { isActive: true } },
      select: { classId: true, sectionId: true, subjectId: true, academicYearId: true },
    });
    const sections = await this.database.section.findMany({
      where: {
        OR: [
          { id: { in: assignments.filter((a) => a.sectionId).map((a) => a.sectionId as string) } },
          { classId: { in: assignments.filter((a) => !a.sectionId).map((a) => a.classId) } },
        ],
        isArchived: false,
      },
      select: { id: true, name: true, class: { select: { name: true } } },
    });
    const attendancePending = [];
    for (const section of sections) {
      const [active, marked] = await Promise.all([
        this.database.enrollment.count({ where: { sectionId: section.id, status: 'ACTIVE' } }),
        this.database.attendanceRecord.count({
          where: { attendanceDate: date, enrollment: { sectionId: section.id } },
        }),
      ]);
      if (active > marked) {
        attendancePending.push({ sectionId: section.id, section: `${section.class.name} - ${section.name}`, unmarked: active - marked });
      }
    }
    const [toReview, draftMarks] = await Promise.all([
      this.database.homeworkSubmission.count({
        where: { status: 'SUBMITTED', homework: { teacherId: staffId } },
      }),
      this.database.assessment.findMany({
        where: {
          examination: { status: 'DRAFT' },
          OR: assignments.map((assignment) => ({ classId: assignment.classId, subjectId: assignment.subjectId })),
        },
        select: {
          id: true,
          subject: { select: { name: true } },
          class: { select: { name: true } },
          examination: { select: { name: true } },
          _count: { select: { marks: true } },
        },
      }),
    ]);
    return {
      attendancePending,
      submissionsToReview: toReview,
      marksEntry: assignments.length
        ? draftMarks.map((assessment) => ({
            assessmentId: assessment.id,
            examination: assessment.examination.name,
            class: assessment.class.name,
            subject: assessment.subject.name,
            marksEntered: assessment._count.marks,
          }))
        : [],
    };
  }

  private async childrenSummary(context: SchoolContext, guardianId: string) {
    const guardian = await this.database.guardian.findFirst({
      where: { id: guardianId, schoolId: context.schoolId },
      include: { students: { include: { student: true } } },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    const since = new Date(Date.now() - 30 * DAY_MS);
    const summaries = [];
    for (const { student } of guardian.students) {
      const enrollment = await this.database.enrollment.findFirst({
        where: { studentId: student.id, status: 'ACTIVE' },
        include: { class: { select: { name: true } }, section: { select: { id: true, name: true } } },
      });
      const [attendance, homework, fees, leaves, latestResult] = await Promise.all([
        this.database.attendanceRecord.groupBy({
          by: ['status'],
          where: { enrollment: { studentId: student.id }, attendanceDate: { gte: since } },
          _count: { _all: true },
        }),
        enrollment
          ? this.database.homework.count({
              where: {
                sectionId: enrollment.sectionId,
                status: 'PUBLISHED',
                dueDate: { gte: today() },
                submissions: { none: { studentId: student.id } },
              },
            })
          : Promise.resolve(0),
        this.database.studentFee.findMany({
          where: { studentId: student.id, status: { in: ['PENDING', 'PARTIAL'] } },
          select: { totalAmount: true, discountAmount: true, paidAmount: true, dueDate: true },
        }),
        this.database.studentLeave.findMany({
          where: { studentId: student.id, status: 'PENDING' },
          select: { id: true, fromDate: true, toDate: true },
        }),
        this.database.examination.findFirst({
          where: { status: 'RELEASED', assessments: { some: { marks: { some: { studentId: student.id } } } } },
          orderBy: { releasedAt: 'desc' },
          select: { id: true, name: true, releasedAt: true },
        }),
      ]);
      const counts = Object.fromEntries(attendance.map((row) => [row.status, row._count._all]));
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      summaries.push({
        student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
        class: enrollment ? `${enrollment.class.name} - ${enrollment.section.name}` : null,
        attendanceLast30Days: {
          ...counts,
          rate: total ? round((((counts.PRESENT ?? 0) + (counts.LATE ?? 0)) / total) * 100) : null,
        },
        homeworkPending: homework,
        feeBalance: fees.reduce(
          (sum, fee) => sum + Number(fee.totalAmount) - Number(fee.discountAmount) - Number(fee.paidAmount),
          0,
        ),
        pendingLeaveRequests: leaves,
        latestResult,
      });
    }
    return { guardianId, children: summaries };
  }

  private async selfOrLeader(authUser: SupabaseUser, staffId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && context.staffId !== staffId) {
      throw new ForbiddenException('You can view only your own work');
    }
    return context;
  }

  private async leader(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    return context;
  }

  private async finance(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isAccountant && !context.isLeader) {
      throw new ForbiddenException('Accountant or School Admin access is required');
    }
    return context;
  }
}
