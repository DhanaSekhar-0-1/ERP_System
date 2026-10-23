import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma, SyncStatus } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ExaminationsService } from '../examinations/examinations.service';
import {
  OfflineAttendanceItemDto,
  OfflineMarkItemDto,
  ResolveConflictDto,
  SyncBatchDto,
} from './dto/sync.dto';

type ItemResult = { index: number; result: 'applied' | 'unchanged' | 'conflict' | 'failed'; message?: string };

/**
 * Offline entries are pending operations, not authoritative records. Each item is replayed
 * through the normal server rules; when the server record changed after the device captured
 * its copy, the item becomes a visible conflict instead of silently overwriting.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly exams: ExaminationsService,
  ) {}

  async batch(authUser: SupabaseUser, input: SyncBatchDto) {
    if (input.type === 'attendance') {
      return this.syncAttendance(authUser, input.deviceId, this.validated(OfflineAttendanceItemDto, input.items));
    }
    return this.syncMarks(authUser, input.deviceId, this.validated(OfflineMarkItemDto, input.items));
  }

  async syncAttendance(authUser: SupabaseUser, deviceId: string | undefined, items: OfflineAttendanceItemDto[]) {
    const context = await this.access.schoolContext(authUser);
    const results: ItemResult[] = [];
    const conflicts: Prisma.SyncConflictCreateManyBatchInput[] = [];
    for (const [index, item] of items.entries()) {
      try {
        const date = new Date(item.attendanceDate.slice(0, 10));
        const existing = await this.database.attendanceRecord.findUnique({
          where: { enrollmentId_attendanceDate: { enrollmentId: item.enrollmentId, attendanceDate: date } },
        });
        if (!existing) {
          await this.attendance.create(authUser, { ...item, remarks: item.remarks ?? 'Offline entry' });
          results.push({ index, result: 'applied' });
        } else if (existing.status === item.status) {
          results.push({ index, result: 'unchanged' });
        } else if (existing.updatedAt > new Date(item.capturedAt)) {
          conflicts.push({
            schoolId: context.schoolId,
            entityType: 'attendance',
            entityId: existing.id,
            clientPayload: item as unknown as Prisma.InputJsonValue,
            serverPayload: { status: existing.status, updatedAt: existing.updatedAt.toISOString() },
          });
          results.push({ index, result: 'conflict', message: 'Changed on the server after capture' });
        } else {
          await this.attendance.update(authUser, existing.id, {
            status: item.status,
            remarks: item.remarks,
            reason: 'Offline sync',
          });
          results.push({ index, result: 'applied' });
        }
      } catch (error) {
        results.push({ index, result: 'failed', message: this.message(error) });
      }
    }
    return this.recordBatch(context, 'attendance', deviceId, results, conflicts);
  }

  async syncMarks(authUser: SupabaseUser, deviceId: string | undefined, items: OfflineMarkItemDto[]) {
    const context = await this.access.schoolContext(authUser);
    const results: ItemResult[] = [];
    const conflicts: Prisma.SyncConflictCreateManyBatchInput[] = [];
    for (const [index, item] of items.entries()) {
      try {
        const existing = await this.database.mark.findUnique({
          where: { assessmentId_studentId: { assessmentId: item.assessmentId, studentId: item.studentId } },
        });
        if (existing && (existing.status === 'SUBMITTED' || existing.updatedAt > new Date(item.capturedAt))) {
          conflicts.push({
            schoolId: context.schoolId,
            entityType: 'mark',
            entityId: existing.id,
            clientPayload: item as unknown as Prisma.InputJsonValue,
            serverPayload: {
              marksObtained: existing.marksObtained?.toString() ?? null,
              status: existing.status,
              updatedAt: existing.updatedAt.toISOString(),
            },
          });
          results.push({ index, result: 'conflict', message: 'Submitted or changed on the server' });
          continue;
        }
        await this.exams.createMark(authUser, item);
        results.push({ index, result: 'applied' });
      } catch (error) {
        results.push({ index, result: 'failed', message: this.message(error) });
      }
    }
    return this.recordBatch(context, 'mark-drafts', deviceId, results, conflicts);
  }

  async findBatch(authUser: SupabaseUser, batchId: string) {
    const context = await this.access.schoolContext(authUser);
    const batch = await this.database.syncBatch.findFirst({
      where: {
        id: batchId,
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { userId: context.userId }),
      },
      include: { conflicts: true },
    });
    if (!batch) throw new NotFoundException('Sync batch not found');
    return batch;
  }

  async conflicts(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.syncConflict.findMany({
      where: {
        schoolId: context.schoolId,
        status: 'OPEN',
        ...(context.isLeader ? {} : { batch: { userId: context.userId } }),
      },
      orderBy: { createdAt: 'asc' },
      include: { batch: { select: { userId: true, deviceId: true, type: true, createdAt: true } } },
    });
  }

  /** APPLY_CLIENT replays the offline value through the normal edit path (with audit). */
  async resolve(authUser: SupabaseUser, conflictId: string, input: ResolveConflictDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const conflict = await this.database.syncConflict.findFirst({
      where: { id: conflictId, schoolId: context.schoolId },
    });
    if (!conflict) throw new NotFoundException('Conflict not found');
    if (conflict.status !== 'OPEN') throw new ConflictException('This conflict is already resolved');
    if (input.resolution === 'APPLY_CLIENT') {
      if (conflict.entityType === 'attendance' && conflict.entityId) {
        const item = conflict.clientPayload as unknown as OfflineAttendanceItemDto;
        await this.attendance.update(authUser, conflict.entityId, {
          status: item.status,
          remarks: item.remarks,
          reason: `Offline conflict resolved: ${input.note ?? 'client value applied'}`,
        });
      } else if (conflict.entityType === 'mark' && conflict.entityId) {
        const item = conflict.clientPayload as unknown as OfflineMarkItemDto;
        await this.exams.updateMark(authUser, conflict.entityId, {
          marksObtained: item.marksObtained,
          isAbsent: item.isAbsent,
        });
      }
    }
    const resolved = await this.database.syncConflict.update({
      where: { id: conflict.id },
      data: {
        status: 'RESOLVED',
        resolution: input.resolution,
        resolvedById: context.userId,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record(context, {
      action: 'sync.conflict-resolved',
      entityType: conflict.entityType,
      entityId: conflict.entityId ?? conflict.id,
      newValue: { resolution: input.resolution },
      reason: input.note,
    });
    return resolved;
  }

  /** What a device needs to know before working offline. */
  async checkpoint(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    const year = await this.database.academicYear.findFirst({
      where: { schoolId: context.schoolId, isActive: true },
    });
    const [timetableChange, openConflicts] = await Promise.all([
      this.database.timetable.aggregate({
        where: { schoolId: context.schoolId, ...(year ? { academicYearId: year.id } : {}) },
        _max: { updatedAt: true },
      }),
      this.database.syncConflict.count({
        where: { schoolId: context.schoolId, status: 'OPEN', batch: { userId: context.userId } },
      }),
    ]);
    return {
      serverTime: new Date().toISOString(),
      activeAcademicYear: year ? { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn } : null,
      timetableUpdatedAt: timetableChange._max.updatedAt,
      openConflicts,
      onlineOnly: ['payments', 'marks release', 'approvals', 'complaints'],
    };
  }

  private async recordBatch(
    context: SchoolContext,
    type: string,
    deviceId: string | undefined,
    results: ItemResult[],
    conflicts: Prisma.SyncConflictCreateManyBatchInput[],
  ) {
    const applied = results.filter((item) => item.result === 'applied' || item.result === 'unchanged').length;
    const status: SyncStatus =
      applied === results.length ? 'PROCESSED' : applied === 0 ? 'FAILED' : 'PARTIAL';
    const batch = await this.database.syncBatch.create({
      data: {
        schoolId: context.schoolId,
        userId: context.userId,
        deviceId: deviceId ?? null,
        type,
        status,
        itemCount: results.length,
        appliedCount: applied,
        conflictCount: conflicts.length,
        results: results as unknown as Prisma.InputJsonValue,
        conflicts: { createMany: { data: conflicts } },
      },
      include: { conflicts: true },
    });
    return batch;
  }

  private validated<T extends object>(type: new () => T, items: Record<string, unknown>[]): T[] {
    return items.map((item, index) => {
      const instance = plainToInstance(type, item);
      const errors = validateSync(instance, { whitelist: true });
      if (errors.length) {
        throw new BadRequestException(`Item ${index} is invalid: ${errors.map((e) => e.property).join(', ')}`);
      }
      return instance;
    });
  }

  private message(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      return typeof response === 'string' ? response : String((response as { message?: unknown }).message);
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
