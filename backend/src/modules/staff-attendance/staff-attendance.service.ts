import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveSession, Prisma, StaffAttendance } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ROLE } from '../../common/access/roles';
import { distanceMetres, isTimeZone, schoolNow, schoolTimeToInstant } from '../../common/identity/school-time';
import {
  LocationDto,
  StaffAttendanceCorrectionDto,
  StaffAttendanceQueryDto,
  StaffAttendanceSettingsDto,
} from './staff-attendance.dto';

/** Readings less accurate than this are refused: the phone cannot tell if it is at school. */
const MAX_ACCURACY_M = 150;
const DEFAULT_RADIUS_M = 200;
const DEFAULT_LATE_AFTER = '09:15';

export interface AttendanceRules {
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  lateAfter: string;
  /** False until the school location is saved; check-in is refused until then. */
  locationReady: boolean;
}

type DayStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ON_LEAVE' | 'NOT_CHECKED_IN';

/**
 * Teacher check-in and check-out (MVP1 step 6a, docs/mvp-plan.md): only within the school's
 * radius, late after the school's set time, once per day each, never while on approved leave.
 * The School Admin or Super Admin can mark or change a day with a reason.
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  // ---------- settings ----------

  async rules(schoolId: string): Promise<AttendanceRules> {
    const settings = await this.database.schoolSettings.findUnique({
      where: { schoolId },
      select: { timezone: true, metadata: true },
    });
    const saved = (settings?.metadata as { staffAttendance?: Partial<AttendanceRules> } | null)?.staffAttendance ?? {};
    const timeZone = settings?.timezone && isTimeZone(settings.timezone) ? settings.timezone : 'Asia/Kolkata';
    const latitude = typeof saved.latitude === 'number' ? saved.latitude : null;
    const longitude = typeof saved.longitude === 'number' ? saved.longitude : null;
    return {
      timeZone,
      latitude,
      longitude,
      radiusMeters: saved.radiusMeters ?? DEFAULT_RADIUS_M,
      lateAfter: saved.lateAfter ?? DEFAULT_LATE_AFTER,
      locationReady: latitude !== null && longitude !== null,
    };
  }

  async getSettings(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.rules(context.schoolId);
  }

  async updateSettings(authUser: SupabaseUser, input: StaffAttendanceSettingsDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can change teacher attendance settings');
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      throw new BadRequestException('Give both latitude and longitude for the school location');
    }
    const before = await this.rules(context.schoolId);
    const settings = await this.database.schoolSettings.findUnique({
      where: { schoolId: context.schoolId },
      select: { metadata: true },
    });
    const metadata = (settings?.metadata as Record<string, unknown> | null) ?? {};
    const current = (metadata.staffAttendance as Record<string, unknown> | undefined) ?? {};
    const next = {
      ...current,
      ...(input.latitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : {}),
      ...(input.radiusMeters !== undefined ? { radiusMeters: input.radiusMeters } : {}),
      ...(input.lateAfter !== undefined ? { lateAfter: input.lateAfter } : {}),
    };
    const merged = { ...metadata, staffAttendance: next } as Prisma.InputJsonValue;
    await this.database.schoolSettings.upsert({
      where: { schoolId: context.schoolId },
      create: { schoolId: context.schoolId, timezone: before.timeZone, metadata: merged },
      update: { metadata: merged },
    });
    await this.audit.record(context, {
      action: 'staff-attendance.settings-updated',
      entityType: 'school',
      entityId: context.schoolId,
      oldValue: { radiusMeters: before.radiusMeters, lateAfter: before.lateAfter, locationSet: before.locationReady },
      newValue: { radiusMeters: next.radiusMeters, lateAfter: next.lateAfter, locationSet: next.latitude !== undefined },
    });
    return this.rules(context.schoolId);
  }

  // ---------- the teacher's own day ----------

  /** What the phone shows: today's record, whether on leave, and the school's rules. */
  async today(authUser: SupabaseUser) {
    const context = await this.teacher(authUser);
    const rules = await this.rules(context.schoolId);
    const { date } = schoolNow(rules.timeZone);
    const [record, leave] = await Promise.all([
      this.database.staffAttendance.findUnique({
        where: { staffId_date: { staffId: context.staffId, date: new Date(date) } },
      }),
      this.approvedLeave(context.staffId, date),
    ]);
    return {
      date,
      record: record ? this.view(record, rules.timeZone) : null,
      onLeave: leave === 'FULL_DAY',
      /** MORNING or AFTERNOON when the teacher has an approved half day today. */
      halfDayLeave: leave === 'MORNING' || leave === 'AFTERNOON' ? leave : null,
      lateAfter: rules.lateAfter,
      radiusMeters: rules.radiusMeters,
      locationReady: rules.locationReady,
    };
  }

  async checkIn(authUser: SupabaseUser, input: LocationDto) {
    const context = await this.teacher(authUser);
    const rules = await this.rules(context.schoolId);
    const distance = this.assertAtSchool(rules, input);
    const now = new Date();
    const { date, time } = schoolNow(rules.timeZone, now);
    const leave = await this.approvedLeave(context.staffId, date);
    if (leave === 'FULL_DAY') {
      throw new ConflictException('You are on approved leave today');
    }
    const existing = await this.database.staffAttendance.findUnique({
      where: { staffId_date: { staffId: context.staffId, date: new Date(date) } },
    });
    if (existing?.checkInAt) {
      throw new ConflictException(
        `You already checked in today at ${schoolNow(rules.timeZone, existing.checkInAt).time}`,
      );
    }
    if (existing) {
      throw new ConflictException(`Today is already recorded as ${this.label(existing.status)}; ask the School Admin`);
    }
    // On a morning half day the teacher arrives after lunch, so the late time does not apply.
    const status = leave !== 'MORNING' && time > rules.lateAfter ? 'LATE' : 'PRESENT';
    const record = await this.database.staffAttendance.create({
      data: {
        schoolId: context.schoolId,
        staffId: context.staffId,
        date: new Date(date),
        status,
        checkInAt: now,
        checkInDistanceM: distance,
      },
    });
    await this.audit.record(context, {
      action: 'staff-attendance.checked-in',
      entityType: 'staff-attendance',
      entityId: record.id,
      newValue: { date, status, time, distanceMetres: distance },
    });
    return this.view(record, rules.timeZone);
  }

  async checkOut(authUser: SupabaseUser, input: LocationDto) {
    const context = await this.teacher(authUser);
    const rules = await this.rules(context.schoolId);
    const distance = this.assertAtSchool(rules, input);
    const now = new Date();
    const { date, time } = schoolNow(rules.timeZone, now);
    const existing = await this.database.staffAttendance.findUnique({
      where: { staffId_date: { staffId: context.staffId, date: new Date(date) } },
    });
    if (!existing?.checkInAt) {
      throw new ConflictException('Check in first');
    }
    if (existing.checkOutAt) {
      throw new ConflictException(
        `You already checked out today at ${schoolNow(rules.timeZone, existing.checkOutAt).time}`,
      );
    }
    const record = await this.database.staffAttendance.update({
      where: { id: existing.id },
      data: { checkOutAt: now, checkOutDistanceM: distance },
    });
    await this.audit.record(context, {
      action: 'staff-attendance.checked-out',
      entityType: 'staff-attendance',
      entityId: record.id,
      newValue: { date, time, distanceMetres: distance },
    });
    return this.view(record, rules.timeZone);
  }

  // ---------- the school's view ----------

  /**
   * Every teacher's day for a school-local date (default today): checked in, late, on leave,
   * corrected, or not checked in (which counts as absent once the day is over).
   */
  async day(authUser: SupabaseUser, query: StaffAttendanceQueryDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context, 'Only school leaders can see teacher attendance');
    const rules = await this.rules(context.schoolId);
    const today = schoolNow(rules.timeZone).date;
    const date = query.date?.slice(0, 10) ?? today;
    const day = new Date(date);
    const teachers = await this.database.staffProfile.findMany({
      where: {
        schoolId: context.schoolId,
        user: {
          status: 'ACTIVE',
          AND: [
            { roles: { some: { role: { name: ROLE.TEACHER } } } },
            { roles: { none: { role: { name: ROLE.PRINCIPAL } } } },
          ],
        },
      },
      select: {
        id: true,
        employeeNo: true,
        teachingSubjects: true,
        user: { select: { displayName: true, phone: true } },
        attendance: { where: { date: day } },
        leaves: {
          where: { status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day } },
          select: { leaveType: true, session: true },
          take: 1,
        },
      },
      orderBy: { employeeNo: 'asc' },
    });
    const rows = teachers.map((teacher) => {
      const record = teacher.attendance[0];
      const leave = teacher.leaves[0];
      const status: DayStatus = record
        ? record.status
        : leave?.session === 'FULL_DAY'
          ? 'ON_LEAVE'
          : date < today
            ? 'ABSENT'
            : 'NOT_CHECKED_IN';
      return {
        staffId: teacher.id,
        teacherId: teacher.employeeNo,
        name: teacher.user.displayName,
        phone: teacher.user.phone,
        subjects: teacher.teachingSubjects,
        status,
        record: record ? this.view(record, rules.timeZone) : null,
        leaveType: leave?.leaveType ?? null,
        /** FULL_DAY, MORNING or AFTERNOON when the teacher has approved leave that day. */
        leaveSession: leave?.session ?? null,
      };
    });
    const count = (status: DayStatus) => rows.filter((row) => row.status === status).length;
    return {
      date,
      isToday: date === today,
      lateAfter: rules.lateAfter,
      summary: {
        total: rows.length,
        present: count('PRESENT'),
        late: count('LATE'),
        onLeave: count('ON_LEAVE'),
        absent: count('ABSENT'),
        notCheckedIn: count('NOT_CHECKED_IN'),
      },
      teachers: rows,
    };
  }

  /** The School Admin or Super Admin marks or changes a teacher's day, with a reason. */
  async correct(authUser: SupabaseUser, staffId: string, input: StaffAttendanceCorrectionDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can correct teacher attendance');
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Teacher not found in this school');
    const rules = await this.rules(context.schoolId);
    const date = input.date.slice(0, 10);
    if (date > schoolNow(rules.timeZone).date) {
      throw new BadRequestException('Cannot record attendance for a future day');
    }
    const attended = input.status === 'PRESENT' || input.status === 'LATE';
    if (!attended && (input.checkInTime || input.checkOutTime)) {
      throw new BadRequestException('Check-in and check-out times only apply to Present or Late');
    }
    if (input.checkInTime && input.checkOutTime && input.checkOutTime <= input.checkInTime) {
      throw new BadRequestException('Check-out time must be after check-in time');
    }
    const existing = await this.database.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: new Date(date) } },
    });
    const at = (time?: string) => (time ? schoolTimeToInstant(date, time, rules.timeZone) : undefined);
    const data = {
      status: input.status,
      checkInAt: attended ? (at(input.checkInTime) ?? existing?.checkInAt ?? null) : null,
      checkOutAt: attended ? (at(input.checkOutTime) ?? existing?.checkOutAt ?? null) : null,
      correctedById: context.userId,
      correctionReason: input.reason.trim(),
    };
    const record = await this.database.staffAttendance.upsert({
      where: { staffId_date: { staffId, date: new Date(date) } },
      create: { schoolId: context.schoolId, staffId, date: new Date(date), ...data },
      update: data,
    });
    await this.audit.record(context, {
      action: 'staff-attendance.corrected',
      entityType: 'staff-attendance',
      entityId: record.id,
      oldValue: existing
        ? { status: existing.status, checkInAt: existing.checkInAt, checkOutAt: existing.checkOutAt }
        : null,
      newValue: { date, status: record.status, checkInAt: record.checkInAt, checkOutAt: record.checkOutAt },
      reason: input.reason.trim(),
    });
    return this.view(record, rules.timeZone);
  }

  // ---------- helpers ----------

  private async teacher(authUser: SupabaseUser): Promise<SchoolContext & { staffId: string }> {
    const context = await this.access.schoolContext(authUser);
    if (!context.staffId) {
      throw new ForbiddenException('Only teachers check in');
    }
    return context as SchoolContext & { staffId: string };
  }

  /** Refuses a reading that is too rough or too far away; returns the distance in metres. */
  private assertAtSchool(rules: AttendanceRules, input: LocationDto): number {
    if (!rules.locationReady || rules.latitude === null || rules.longitude === null) {
      throw new ConflictException('The school location is not set yet. Ask the School Admin to set it in Settings.');
    }
    if (input.accuracy > MAX_ACCURACY_M) {
      throw new BadRequestException(
        `Your location is only accurate to ${Math.round(input.accuracy)} m. Move outside or near a window and try again.`,
      );
    }
    const distance = distanceMetres(input, { latitude: rules.latitude, longitude: rules.longitude });
    if (distance > rules.radiusMeters) {
      throw new ForbiddenException(
        `You are ${distance} m from school. Check-in works within ${rules.radiusMeters} m of the school.`,
      );
    }
    return distance;
  }

  /** The session of the teacher's approved leave on a date, or null when there is none. */
  private async approvedLeave(staffId: string, date: string): Promise<LeaveSession | null> {
    const day = new Date(date);
    const leave = await this.database.staffLeave.findFirst({
      where: { staffId, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day } },
      select: { session: true },
    });
    return leave?.session ?? null;
  }

  private view(record: StaffAttendance, timeZone: string) {
    const time = (value: Date | null) => (value ? schoolNow(timeZone, value).time : null);
    const minutes =
      record.checkInAt && record.checkOutAt
        ? Math.round((record.checkOutAt.getTime() - record.checkInAt.getTime()) / 60_000)
        : null;
    return {
      id: record.id,
      date: record.date.toISOString().slice(0, 10),
      status: record.status,
      checkInTime: time(record.checkInAt),
      checkOutTime: time(record.checkOutAt),
      minutesAtSchool: minutes,
      checkInDistanceM: record.checkInDistanceM,
      checkOutDistanceM: record.checkOutDistanceM,
      corrected: Boolean(record.correctedById),
      correctionReason: record.correctionReason,
    };
  }

  private label(status: string) {
    return status.toLowerCase().replace('_', ' ');
  }
}
