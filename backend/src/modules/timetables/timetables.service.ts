import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Timetable } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotifyService } from '../../common/notify/notify.service';
import { isoWeekday } from '../leaves/leaves.service';
import {
  CreateSlotDto,
  CreateSubstituteRequestDto,
  CreateTimetableDto,
  GenerateDraftDto,
  SlotQueryDto,
  SubstituteQueryDto,
  UpdateSlotDto,
} from './dto/timetables.dto';

const DEFAULT_MAX_PERIODS_PER_DAY = 6;
const NO_MATCH = '00000000-0000-0000-0000-000000000000';
const DEFAULT_MAX_PERIODS_PER_WEEK = 32;

export interface SlotConflict {
  type: 'TEACHER_BUSY' | 'ROOM_BUSY' | 'SLOT_TAKEN' | 'NOT_ASSIGNED' | 'DAILY_WORKLOAD' | 'WEEKLY_WORKLOAD';
  message: string;
}

const SLOT_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  staff: { select: { id: true, employeeNo: true, user: { select: { displayName: true } } } },
} as const;

/** Rule-based scheduling: predictable and explainable, shared by timetables and substitutes. */
@Injectable()
export class TimetablesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  // ---------- Timetables ----------

  async create(authUser: SupabaseUser, input: CreateTimetableDto) {
    const context = await this.leader(authUser);
    await this.assertSection(context, input.academicYearId, input.sectionId);
    try {
      return await this.database.timetable.create({
        data: { schoolId: context.schoolId, academicYearId: input.academicYearId, sectionId: input.sectionId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This section already has a timetable for the year');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser, academicYearId?: string, sectionId?: string) {
    const context = await this.access.schoolContext(authUser);
    return this.database.timetable.findMany({
      where: {
        schoolId: context.schoolId,
        ...(academicYearId ? { academicYearId } : {}),
        ...(sectionId ? { sectionId } : {}),
        ...(context.isLeader ? {} : { status: { in: ['PUBLISHED', 'LOCKED'] } }),
      },
      include: {
        section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        _count: { select: { slots: true } },
      },
    });
  }

  async findOne(authUser: SupabaseUser, timetableId: string) {
    const context = await this.access.schoolContext(authUser);
    const timetable = await this.database.timetable.findFirst({
      where: {
        id: timetableId,
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { status: { in: ['PUBLISHED', 'LOCKED'] } }),
      },
      include: {
        section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        slots: { include: SLOT_INCLUDE, orderBy: [{ dayOfWeek: 'asc' }, { periodNo: 'asc' }] },
      },
    });
    if (!timetable) throw new NotFoundException('Timetable not found');
    return timetable;
  }

  /** Moves a published timetable back to draft for editing; locked ones stay frozen. */
  async reopen(authUser: SupabaseUser, timetableId: string) {
    const context = await this.leader(authUser);
    const timetable = await this.scoped(context, timetableId);
    if (timetable.status === 'LOCKED') throw new ConflictException('A locked timetable cannot be reopened');
    return this.database.timetable.update({ where: { id: timetable.id }, data: { status: 'DRAFT' } });
  }

  async setStatus(authUser: SupabaseUser, timetableId: string, status: 'PUBLISHED' | 'LOCKED') {
    const context = await this.leader(authUser);
    const timetable = await this.scoped(context, timetableId);
    if (status === 'PUBLISHED' && timetable.status !== 'DRAFT') {
      throw new ConflictException(`Timetable is already ${timetable.status.toLowerCase()}`);
    }
    if (status === 'LOCKED' && timetable.status !== 'PUBLISHED') {
      throw new ConflictException('Only published timetables can be locked');
    }
    if (status === 'PUBLISHED') {
      const report = await this.validateTimetable(context, timetable);
      if (report.conflicts.length) {
        throw new ConflictException(`Timetable has ${report.conflicts.length} conflicts; run validate`);
      }
    }
    const updated = await this.database.timetable.update({ where: { id: timetable.id }, data: { status } });
    await this.audit.record(context, {
      action: `timetable.${status.toLowerCase()}`,
      entityType: 'timetable',
      entityId: timetable.id,
    });
    return updated;
  }

  async validate(authUser: SupabaseUser, timetableId: string) {
    const context = await this.leader(authUser);
    const timetable = await this.scoped(context, timetableId);
    return this.validateTimetable(context, timetable);
  }

  /**
   * Greedy draft: spreads each subject's weekly periods across days, skipping any period
   * where the assigned teacher is already busy or at the daily limit. Leftovers are reported.
   */
  async generateDraft(authUser: SupabaseUser, input: GenerateDraftDto) {
    const context = await this.leader(authUser);
    const section = await this.assertSection(context, input.academicYearId, input.sectionId);
    const timetable =
      (await this.database.timetable.findUnique({
        where: { academicYearId_sectionId: { academicYearId: input.academicYearId, sectionId: input.sectionId } },
      })) ??
      (await this.database.timetable.create({
        data: { schoolId: context.schoolId, academicYearId: input.academicYearId, sectionId: input.sectionId },
      }));
    if (timetable.status !== 'DRAFT') throw new ConflictException('Only draft timetables can be generated');

    const assignments = await this.database.staffAssignment.findMany({
      where: {
        academicYearId: input.academicYearId,
        classId: section.classId,
        OR: [{ sectionId: null }, { sectionId: section.id }],
      },
    });
    if (!assignments.length) throw new BadRequestException('No teacher assignments exist for this section');
    const teacherFor = new Map<string, string>();
    for (const assignment of assignments) {
      if (!teacherFor.has(assignment.subjectId) || assignment.sectionId) {
        teacherFor.set(assignment.subjectId, assignment.staffId);
      }
    }
    const days = input.days?.length ? input.days : [1, 2, 3, 4, 5, 6];
    const capacity = days.length * input.periodsPerDay;
    const subjects =
      input.subjects?.filter((entry) => teacherFor.has(entry.subjectId)) ??
      [...teacherFor.keys()].map((subjectId, index, all) => ({
        subjectId,
        periodsPerWeek:
          Math.floor(capacity / all.length) + (index < capacity % all.length ? 1 : 0),
      }));
    const limits = await this.limits(context.schoolId);

    await this.database.timetableSlot.deleteMany({ where: { timetableId: timetable.id } });
    const busy = await this.database.timetableSlot.findMany({
      where: { academicYearId: input.academicYearId },
      select: { staffId: true, dayOfWeek: true, periodNo: true },
    });
    const taken = new Set(busy.map((slot) => `${slot.staffId}:${slot.dayOfWeek}:${slot.periodNo}`));
    const perDay = new Map<string, number>();
    for (const slot of busy) {
      const key = `${slot.staffId}:${slot.dayOfWeek}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    const sectionFree = new Set(days.flatMap((day) =>
      Array.from({ length: input.periodsPerDay }, (_, index) => `${day}:${index + 1}`),
    ));

    const created: Prisma.TimetableSlotCreateManyInput[] = [];
    const unplaced: { subjectId: string; periods: number }[] = [];
    for (const subject of subjects) {
      const staffId = teacherFor.get(subject.subjectId) as string;
      let remaining = subject.periodsPerWeek;
      for (let round = 0; remaining > 0 && round < input.periodsPerDay; round += 1) {
        for (const day of days) {
          if (remaining === 0) break;
          const dayKey = `${staffId}:${day}`;
          if ((perDay.get(dayKey) ?? 0) >= limits.perDay) continue;
          for (let offset = 0; offset < input.periodsPerDay; offset += 1) {
            const period = ((round + offset + day) % input.periodsPerDay) + 1;
            const cell = `${day}:${period}`;
            if (!sectionFree.has(cell) || taken.has(`${staffId}:${day}:${period}`)) continue;
            sectionFree.delete(cell);
            taken.add(`${staffId}:${day}:${period}`);
            perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
            created.push({
              schoolId: context.schoolId,
              timetableId: timetable.id,
              academicYearId: input.academicYearId,
              dayOfWeek: day,
              periodNo: period,
              subjectId: subject.subjectId,
              staffId,
            });
            remaining -= 1;
            break;
          }
        }
      }
      if (remaining > 0) unplaced.push({ subjectId: subject.subjectId, periods: remaining });
    }
    await this.database.timetableSlot.createMany({ data: created });
    await this.audit.record(context, {
      action: 'timetable.draft-generated',
      entityType: 'timetable',
      entityId: timetable.id,
      newValue: { slots: created.length, unplaced },
    });
    return { timetable: await this.findOne(authUser, timetable.id), placed: created.length, unplaced };
  }

  // ---------- Slots ----------

  async findSlots(authUser: SupabaseUser, query: SlotQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.timetableSlot.findMany({
      where: {
        schoolId: context.schoolId,
        ...(query.timetableId ? { timetableId: query.timetableId } : {}),
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.sectionId ? { timetable: { sectionId: query.sectionId } } : {}),
        ...(context.isLeader ? {} : { timetable: { status: { in: ['PUBLISHED', 'LOCKED'] } } }),
      },
      orderBy: [{ dayOfWeek: 'asc' }, { periodNo: 'asc' }],
      include: SLOT_INCLUDE,
    });
  }

  async createSlot(authUser: SupabaseUser, input: CreateSlotDto) {
    const context = await this.leader(authUser);
    const timetable = await this.scoped(context, input.timetableId);
    if (timetable.status === 'LOCKED') throw new ConflictException('This timetable is locked');
    const conflicts = await this.checkSlot(context, timetable, input);
    if (conflicts.length) {
      throw new ConflictException({ message: conflicts.map((c) => c.message).join('; '), conflicts });
    }
    const slot = await this.database.timetableSlot.create({
      data: {
        schoolId: context.schoolId,
        timetableId: timetable.id,
        academicYearId: timetable.academicYearId,
        dayOfWeek: input.dayOfWeek,
        periodNo: input.periodNo,
        subjectId: input.subjectId,
        staffId: input.staffId,
        room: input.room?.trim() || null,
      },
      include: SLOT_INCLUDE,
    });
    await this.audit.record(context, {
      action: 'timetable-slot.created',
      entityType: 'timetable-slot',
      entityId: slot.id,
      newValue: input,
    });
    return slot;
  }

  async updateSlot(authUser: SupabaseUser, slotId: string, input: UpdateSlotDto) {
    const context = await this.leader(authUser);
    const slot = await this.scopedSlot(context, slotId);
    if (slot.timetable.status === 'LOCKED') throw new ConflictException('This timetable is locked');
    const next = {
      timetableId: slot.timetableId,
      dayOfWeek: slot.dayOfWeek,
      periodNo: slot.periodNo,
      subjectId: input.subjectId ?? slot.subjectId,
      staffId: input.staffId ?? slot.staffId,
      room: input.room === undefined ? slot.room ?? undefined : input.room,
    };
    const conflicts = await this.checkSlot(context, slot.timetable, next, slot.id);
    if (conflicts.length) {
      throw new ConflictException({ message: conflicts.map((c) => c.message).join('; '), conflicts });
    }
    const updated = await this.database.timetableSlot.update({
      where: { id: slot.id },
      data: { subjectId: next.subjectId, staffId: next.staffId, room: next.room?.trim() || null },
      include: SLOT_INCLUDE,
    });
    await this.audit.record(context, {
      action: 'timetable-slot.updated',
      entityType: 'timetable-slot',
      entityId: slot.id,
      oldValue: { subjectId: slot.subjectId, staffId: slot.staffId, room: slot.room },
      newValue: input,
    });
    return updated;
  }

  async deleteSlot(authUser: SupabaseUser, slotId: string) {
    const context = await this.leader(authUser);
    const slot = await this.scopedSlot(context, slotId);
    if (slot.timetable.status === 'LOCKED') throw new ConflictException('This timetable is locked');
    const substitutes = await this.database.substituteRequest.count({ where: { slotId } });
    if (substitutes) throw new ConflictException('This period has substitute history; reassign it instead');
    await this.database.timetableSlot.delete({ where: { id: slot.id } });
    return { id: slot.id, deleted: true };
  }

  async teacherTimetable(authUser: SupabaseUser, staffId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && context.staffId !== staffId) {
      throw new ForbiddenException('You can view only your own timetable');
    }
    return this.findSlots(authUser, { staffId });
  }

  async sectionTimetable(authUser: SupabaseUser, sectionId: string) {
    const context = await this.access.schoolContext(authUser);
    const year = await this.database.academicYear.findFirst({
      where: { schoolId: context.schoolId, isActive: true },
    });
    const timetable = await this.database.timetable.findFirst({
      where: {
        schoolId: context.schoolId,
        sectionId,
        ...(year ? { academicYearId: year.id } : {}),
        ...(context.isLeader ? {} : { status: { in: ['PUBLISHED', 'LOCKED'] } }),
      },
      include: { slots: { include: SLOT_INCLUDE, orderBy: [{ dayOfWeek: 'asc' }, { periodNo: 'asc' }] } },
    });
    if (!timetable) throw new NotFoundException('No timetable for this section');
    return timetable;
  }

  // ---------- Substitutes ----------

  async findSubstitutes(authUser: SupabaseUser, query: SubstituteQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.substituteRequest.findMany({
      where: {
        schoolId: context.schoolId,
        ...(query.date ? { date: new Date(query.date.slice(0, 10)) } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(context.isLeader
          ? {}
          : {
              OR: [
                { originalStaffId: context.staffId ?? NO_MATCH },
                { substituteStaffId: context.staffId ?? NO_MATCH },
              ],
            }),
      },
      orderBy: [{ date: 'asc' }],
      include: this.substituteInclude(),
    });
  }

  async findSubstitute(authUser: SupabaseUser, requestId: string) {
    const context = await this.access.schoolContext(authUser);
    const request = await this.database.substituteRequest.findFirst({
      where: { id: requestId, schoolId: context.schoolId },
      include: this.substituteInclude(),
    });
    if (!request) throw new NotFoundException('Substitute request not found');
    return request;
  }

  async createSubstitute(authUser: SupabaseUser, input: CreateSubstituteRequestDto) {
    const context = await this.leader(authUser);
    const slot = await this.scopedSlot(context, input.slotId);
    const date = new Date(input.date.slice(0, 10));
    if (isoWeekday(date) !== slot.dayOfWeek) {
      throw new BadRequestException('This period does not run on that date');
    }
    try {
      return await this.database.substituteRequest.create({
        data: {
          schoolId: context.schoolId,
          date,
          slotId: slot.id,
          originalStaffId: slot.staffId,
          reason: input.reason?.trim() || null,
        },
        include: this.substituteInclude(),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A substitute request already exists for this period and date');
      }
      throw error;
    }
  }

  /** Teachers free in that period, not on leave, under the daily limit; subject specialists first. */
  async availableTeachers(authUser: SupabaseUser, requestId: string) {
    const context = await this.leader(authUser);
    const request = await this.findSubstitute(authUser, requestId);
    const slot = request.slot;
    const limits = await this.limits(context.schoolId);
    const [staff, busy, covering, onLeave, dayLoad] = await Promise.all([
      this.database.staffProfile.findMany({
        where: { schoolId: context.schoolId, user: { status: 'ACTIVE' }, id: { not: request.originalStaffId } },
        include: { user: { select: { displayName: true } } },
      }),
      this.database.timetableSlot.findMany({
        where: { academicYearId: slot.academicYearId, dayOfWeek: slot.dayOfWeek, periodNo: slot.periodNo },
        select: { staffId: true },
      }),
      this.database.substituteRequest.findMany({
        where: { date: request.date, status: 'ASSIGNED', slot: { periodNo: slot.periodNo } },
        select: { substituteStaffId: true },
      }),
      this.database.staffLeave.findMany({
        where: { status: 'APPROVED', fromDate: { lte: request.date }, toDate: { gte: request.date } },
        select: { staffId: true },
      }),
      this.database.timetableSlot.groupBy({
        by: ['staffId'],
        where: { academicYearId: slot.academicYearId, dayOfWeek: slot.dayOfWeek },
        _count: { _all: true },
      }),
    ]);
    const unavailable = new Set([
      ...busy.map((entry) => entry.staffId),
      ...covering.map((entry) => entry.substituteStaffId as string),
      ...onLeave.map((entry) => entry.staffId),
    ]);
    const load = new Map(dayLoad.map((row) => [row.staffId, row._count._all]));
    const specialists = new Set(
      (
        await this.database.staffAssignment.findMany({
          where: { academicYearId: slot.academicYearId, subjectId: slot.subjectId },
          select: { staffId: true },
        })
      ).map((assignment) => assignment.staffId),
    );
    return staff
      .filter((member) => !unavailable.has(member.id) && (load.get(member.id) ?? 0) < limits.perDay)
      .map((member) => ({
        staffId: member.id,
        name: member.user.displayName,
        periodsThatDay: load.get(member.id) ?? 0,
        teachesSubject: specialists.has(member.id),
      }))
      .sort(
        (a, b) =>
          Number(b.teachesSubject) - Number(a.teachesSubject) || a.periodsThatDay - b.periodsThatDay,
      );
  }

  async assignSubstitute(authUser: SupabaseUser, requestId: string, staffId: string) {
    const context = await this.leader(authUser);
    const request = await this.findSubstitute(authUser, requestId);
    if (request.status === 'CANCELLED') throw new ConflictException('This request is cancelled');
    const available = await this.availableTeachers(authUser, requestId);
    if (!available.some((teacher) => teacher.staffId === staffId)) {
      throw new ConflictException('This teacher is not free for that period');
    }
    const updated = await this.database.substituteRequest.update({
      where: { id: request.id },
      data: { substituteStaffId: staffId, status: 'ASSIGNED' },
      include: this.substituteInclude(),
    });
    await this.audit.record(context, {
      action: 'substitute.assigned',
      entityType: 'substitute-request',
      entityId: request.id,
      newValue: { substituteStaffId: staffId },
    });
    const substitute = await this.database.staffProfile.findUniqueOrThrow({ where: { id: staffId } });
    await this.notify.toUsers([substitute.userId], {
      type: 'substitute.assigned',
      title: 'Substitute period assigned',
      body: `${updated.slot.subject.name} on ${request.date.toISOString().slice(0, 10)}, period ${request.slot.periodNo}`,
      schoolId: context.schoolId,
      data: { substituteRequestId: request.id },
    });
    return updated;
  }

  async autoAssign(authUser: SupabaseUser, requestId: string) {
    const available = await this.availableTeachers(authUser, requestId);
    if (!available.length) throw new ConflictException('No teacher is free for this period');
    return this.assignSubstitute(authUser, requestId, available[0].staffId);
  }

  async cancelSubstitute(authUser: SupabaseUser, requestId: string) {
    const context = await this.leader(authUser);
    const request = await this.findSubstitute(authUser, requestId);
    const updated = await this.database.substituteRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
      include: this.substituteInclude(),
    });
    await this.audit.record(context, {
      action: 'substitute.cancelled',
      entityType: 'substitute-request',
      entityId: request.id,
    });
    return updated;
  }

  // ---------- Conflict engine ----------

  private async checkSlot(
    context: SchoolContext,
    timetable: Timetable,
    input: { dayOfWeek: number; periodNo: number; subjectId: string; staffId: string; room?: string },
    ignoreSlotId?: string,
  ): Promise<SlotConflict[]> {
    const conflicts: SlotConflict[] = [];
    const notSelf = ignoreSlotId ? { id: { not: ignoreSlotId } } : {};
    const section = await this.database.section.findUniqueOrThrow({ where: { id: timetable.sectionId } });
    const [cell, teacherBusy, roomBusy, assignment, dayCount, weekCount] = await Promise.all([
      this.database.timetableSlot.findFirst({
        where: { ...notSelf, timetableId: timetable.id, dayOfWeek: input.dayOfWeek, periodNo: input.periodNo },
      }),
      this.database.timetableSlot.findFirst({
        where: {
          ...notSelf,
          academicYearId: timetable.academicYearId,
          staffId: input.staffId,
          dayOfWeek: input.dayOfWeek,
          periodNo: input.periodNo,
        },
      }),
      input.room
        ? this.database.timetableSlot.findFirst({
            where: {
              ...notSelf,
              academicYearId: timetable.academicYearId,
              room: input.room.trim(),
              dayOfWeek: input.dayOfWeek,
              periodNo: input.periodNo,
            },
          })
        : Promise.resolve(null),
      this.database.staffAssignment.findFirst({
        where: {
          staffId: input.staffId,
          subjectId: input.subjectId,
          classId: section.classId,
          academicYearId: timetable.academicYearId,
          OR: [{ sectionId: null }, { sectionId: section.id }],
        },
      }),
      this.database.timetableSlot.count({
        where: { ...notSelf, academicYearId: timetable.academicYearId, staffId: input.staffId, dayOfWeek: input.dayOfWeek },
      }),
      this.database.timetableSlot.count({
        where: { ...notSelf, academicYearId: timetable.academicYearId, staffId: input.staffId },
      }),
    ]);
    const limits = await this.limits(context.schoolId);
    if (cell) conflicts.push({ type: 'SLOT_TAKEN', message: 'This section already has a class in that period' });
    if (teacherBusy) conflicts.push({ type: 'TEACHER_BUSY', message: 'The teacher is already teaching in that period' });
    if (roomBusy) conflicts.push({ type: 'ROOM_BUSY', message: `Room ${input.room} is already booked in that period` });
    if (!assignment) {
      conflicts.push({ type: 'NOT_ASSIGNED', message: 'The teacher is not assigned to this subject for this section' });
    }
    if (dayCount >= limits.perDay) {
      conflicts.push({ type: 'DAILY_WORKLOAD', message: `The teacher already has ${dayCount} periods that day` });
    }
    if (weekCount >= limits.perWeek) {
      conflicts.push({ type: 'WEEKLY_WORKLOAD', message: `The teacher already has ${weekCount} periods that week` });
    }
    return conflicts;
  }

  private async validateTimetable(context: SchoolContext, timetable: Timetable) {
    const slots = await this.database.timetableSlot.findMany({ where: { timetableId: timetable.id } });
    const conflicts: (SlotConflict & { slotId: string })[] = [];
    for (const slot of slots) {
      const found = await this.checkSlot(context, timetable, { ...slot, room: slot.room ?? undefined }, slot.id);
      conflicts.push(...found.map((conflict) => ({ ...conflict, slotId: slot.id })));
    }
    return { timetableId: timetable.id, slots: slots.length, valid: conflicts.length === 0, conflicts };
  }

  private async limits(schoolId: string) {
    const settings = await this.database.schoolSettings.findUnique({ where: { schoolId } });
    const metadata = (settings?.metadata ?? {}) as { maxPeriodsPerDay?: number; maxPeriodsPerWeek?: number };
    return {
      perDay: metadata.maxPeriodsPerDay ?? DEFAULT_MAX_PERIODS_PER_DAY,
      perWeek: metadata.maxPeriodsPerWeek ?? DEFAULT_MAX_PERIODS_PER_WEEK,
    };
  }

  private substituteInclude() {
    return {
      slot: { include: { ...SLOT_INCLUDE, timetable: { select: { sectionId: true } } } },
      originalStaff: { select: { id: true, user: { select: { displayName: true } } } },
      substituteStaff: { select: { id: true, user: { select: { displayName: true } } } },
    };
  }

  private async assertSection(context: SchoolContext, academicYearId: string, sectionId: string) {
    const section = await this.database.section.findFirst({
      where: { id: sectionId, academicYearId, schoolId: context.schoolId, isArchived: false },
    });
    if (!section) throw new NotFoundException('Section not found in this academic year');
    return section;
  }

  private async leader(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    return context;
  }

  private async scoped(context: SchoolContext, timetableId: string) {
    const timetable = await this.database.timetable.findFirst({
      where: { id: timetableId, schoolId: context.schoolId },
    });
    if (!timetable) throw new NotFoundException('Timetable not found');
    return timetable;
  }

  private async scopedSlot(context: SchoolContext, slotId: string) {
    const slot = await this.database.timetableSlot.findFirst({
      where: { id: slotId, schoolId: context.schoolId },
      include: { timetable: true },
    });
    if (!slot) throw new NotFoundException('Timetable slot not found');
    return slot;
  }
}
