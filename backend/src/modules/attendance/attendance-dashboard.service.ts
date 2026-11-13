import { Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService } from '../../common/access/access.service';
import { maskAadhaar } from '../../common/identity/aadhaar';

type Counts = Record<'present' | 'late' | 'absent' | 'onLeave' | 'excused', number>;

const empty = (): Counts => ({ present: 0, late: 0, absent: 0, onLeave: 0, excused: 0 });

function add(counts: Counts, status: AttendanceStatus, by = 1) {
  if (status === 'PRESENT') counts.present += by;
  else if (status === 'LATE') counts.late += by;
  else if (status === 'ABSENT') counts.absent += by;
  else if (status === 'ON_LEAVE') counts.onLeave += by;
  else counts.excused += by;
}

/**
 * Attendance % counts only the days attendance was marked for the student (so a student who
 * joined mid-year is counted from admission) and leaves out leave and excused days.
 */
function percent(counts: Counts): number | null {
  const counted = counts.present + counts.late + counts.absent;
  return counted ? Math.round(((counts.present + counts.late) / counted) * 1000) / 10 : null;
}

/**
 * The Admin attendance dashboard (MVP1 step 6b, docs/mvp-plan.md): a day across every section,
 * one section's students with their year-to-date %, and one student's months.
 */
@Injectable()
export class AttendanceDashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
  ) {}

  /** Every section of the active year for one day: who is present, late, absent, on leave, not marked. */
  async day(authUser: SupabaseUser, date: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context, 'Only school leaders can open the attendance dashboard');
    const day = new Date(date);
    const sections = await this.database.section.findMany({
      where: { schoolId: context.schoolId, isArchived: false, academicYear: { isActive: true } },
      orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        class: { select: { id: true, name: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          select: { attendance: { where: { attendanceDate: day }, select: { status: true } } },
        },
      },
    });
    const total = { students: 0, marked: 0, ...empty() };
    const rows = sections.map((section) => {
      const counts = empty();
      let marked = 0;
      for (const enrollment of section.enrollments) {
        const record = enrollment.attendance[0];
        if (record) {
          marked += 1;
          add(counts, record.status);
        }
      }
      const students = section.enrollments.length;
      total.students += students;
      total.marked += marked;
      (Object.keys(counts) as (keyof Counts)[]).forEach((key) => (total[key] += counts[key]));
      return {
        sectionId: section.id,
        classId: section.class.id,
        label: `${section.class.name}-${section.name}`,
        className: section.class.name,
        sectionName: section.name,
        students,
        marked,
        notMarked: students - marked,
        ...counts,
        percent: percent(counts),
      };
    });
    const totalCounts = { present: total.present, late: total.late, absent: total.absent, onLeave: total.onLeave, excused: total.excused };
    return {
      date,
      summary: { ...total, notMarked: total.students - total.marked, percent: percent(totalCounts) },
      sections: rows,
    };
  }

  /** One section's students: status on the day and year-to-date attendance %. */
  async section(authUser: SupabaseUser, sectionId: string, date: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context, 'Only school leaders can open the attendance dashboard');
    const section = await this.database.section.findFirst({
      where: { id: sectionId, schoolId: context.schoolId },
      select: { id: true, name: true, class: { select: { name: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');
    const day = new Date(date);
    const enrollments = await this.database.enrollment.findMany({
      where: { sectionId, schoolId: context.schoolId, status: 'ACTIVE' },
      select: {
        id: true,
        rollNumber: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, admissionDate: true } },
        attendance: { where: { attendanceDate: day }, select: { status: true } },
      },
    });
    const totals = await this.database.attendanceRecord.groupBy({
      by: ['enrollmentId', 'status'],
      where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
      _count: { _all: true },
    });
    const byEnrollment = new Map<string, Counts>();
    for (const row of totals) {
      const counts = byEnrollment.get(row.enrollmentId) ?? empty();
      add(counts, row.status, row._count._all);
      byEnrollment.set(row.enrollmentId, counts);
    }
    const students = enrollments
      .map((enrollment) => {
        const counts = byEnrollment.get(enrollment.id) ?? empty();
        return {
          studentId: enrollment.student.id,
          name: [enrollment.student.firstName, enrollment.student.lastName].filter(Boolean).join(' '),
          admissionNo: enrollment.student.admissionNo,
          rollNumber: enrollment.rollNumber,
          status: enrollment.attendance[0]?.status ?? null,
          year: { ...counts, percent: percent(counts) },
        };
      })
      .sort((a, b) => (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0) || a.name.localeCompare(b.name));
    return { date, sectionId: section.id, label: `${section.class.name}-${section.name}`, students };
  }

  /** One student: details, the current class, and attendance month by month for each year. */
  async student(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    const student = await this.database.student.findFirst({
      where: { id: studentId, schoolId: context.schoolId },
      select: {
        id: true,
        admissionNo: true,
        firstName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
        admissionDate: true,
        admissionType: true,
        bloodGroup: true,
        address: true,
        nfcId: true,
        aadhaarLast4: true,
        aadhaarEnrolmentNo: true,
        isArchived: true,
        guardians: {
          select: { isPrimary: true, guardian: { select: { name: true, phone: true, relation: true } } },
          orderBy: { isPrimary: 'desc' },
        },
        enrollments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            rollNumber: true,
            status: true,
            academicYear: { select: { id: true, name: true, isActive: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
            attendance: { select: { attendanceDate: true, status: true } },
          },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const years = student.enrollments.map((enrollment) => {
      const months = new Map<string, Counts>();
      const overall = empty();
      for (const record of enrollment.attendance) {
        const month = record.attendanceDate.toISOString().slice(0, 7);
        const counts = months.get(month) ?? empty();
        add(counts, record.status);
        add(overall, record.status);
        months.set(month, counts);
      }
      return {
        academicYear: enrollment.academicYear,
        label: `${enrollment.class.name}-${enrollment.section.name}`,
        rollNumber: enrollment.rollNumber,
        status: enrollment.status,
        overall: { ...overall, percent: percent(overall) },
        months: [...months.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, counts]) => ({ month, ...counts, percent: percent(counts) })),
      };
    });
    const { enrollments: _enrollments, aadhaarLast4, ...details } = student;
    return { ...details, aadhaarMasked: maskAadhaar(aadhaarLast4), years };
  }
}
