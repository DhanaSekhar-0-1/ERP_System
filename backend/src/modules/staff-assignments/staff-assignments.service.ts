import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  CreateStaffAssignmentDto,
  ReassignStaffAssignmentDto,
} from './dto/create-staff-assignment.dto';

const INCLUDE = {
  staff: { include: { user: { select: { id: true, displayName: true, email: true } } } },
  class: { select: { id: true, name: true } },
  section: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true, code: true } },
  academicYear: { select: { id: true, name: true } },
} as const;

@Injectable()
export class StaffAssignmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async create(authUser: SupabaseUser, input: CreateStaffAssignmentDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    await this.validate(context, input);

    try {
      return await this.database.$transaction(async (transaction) => {
        const assignment = await transaction.staffAssignment.create({
          data: {
            schoolId: context.schoolId,
            staffId: input.staffId,
            academicYearId: input.academicYearId,
            classId: input.classId,
            sectionId: input.sectionId ?? null,
            subjectId: input.subjectId,
            effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
          },
          include: INCLUDE,
        });
        if (input.isClassTeacher) {
          await this.setClassTeacher(transaction, context, input.sectionId, input.staffId, input.academicYearId);
        }
        await this.audit.record(
          context,
          {
            action: 'staff-assignment.created',
            entityType: 'staff-assignment',
            entityId: assignment.id,
            newValue: input,
          },
          transaction,
        );
        return { ...assignment, isClassTeacher: Boolean(input.isClassTeacher) };
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('This staff assignment already exists');
      }
      throw error;
    }
  }

  async findMany(
    authUser: SupabaseUser,
    filters: { staffId?: string; classId?: string; academicYearId?: string; sectionId?: string },
  ) {
    const context = await this.access.schoolContext(authUser);
    const where: Prisma.StaffAssignmentWhereInput = {
      schoolId: context.schoolId,
      ...(filters.staffId ? { staffId: filters.staffId } : {}),
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
    };
    if (!context.isLeader) {
      where.staffId = context.staffId ?? '00000000-0000-0000-0000-000000000000';
    }
    const assignments = await this.database.staffAssignment.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      include: INCLUDE,
    });
    return this.withClassTeacher(assignments);
  }

  async reassign(
    authUser: SupabaseUser,
    assignmentId: string,
    input: ReassignStaffAssignmentDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const existing = await this.scoped(context, assignmentId);
    const next = {
      staffId: input.staffId ?? existing.staffId,
      academicYearId: existing.academicYearId,
      classId: existing.classId,
      sectionId: input.sectionId === undefined ? existing.sectionId ?? undefined : input.sectionId,
      subjectId: existing.subjectId,
    };
    await this.validate(context, next);
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.staffAssignment.update({
        where: { id: assignmentId },
        data: {
          staffId: next.staffId,
          sectionId: next.sectionId ?? null,
          effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : undefined,
        },
        include: INCLUDE,
      });
      if (input.isClassTeacher === true) {
        await this.setClassTeacher(transaction, context, next.sectionId, next.staffId, next.academicYearId);
      } else if (input.isClassTeacher === false && existing.sectionId) {
        await transaction.classTeacher.deleteMany({
          where: { sectionId: existing.sectionId, staffId: existing.staffId },
        });
      }
      await this.audit.record(
        context,
        {
          action: 'staff-assignment.reassigned',
          entityType: 'staff-assignment',
          entityId: assignmentId,
          oldValue: { staffId: existing.staffId, sectionId: existing.sectionId },
          newValue: { staffId: next.staffId, sectionId: next.sectionId ?? null },
          reason: input.reason,
        },
        transaction,
      );
      const [withFlag] = await this.withClassTeacher([updated], transaction);
      return withFlag;
    });
  }

  async remove(authUser: SupabaseUser, assignmentId: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const existing = await this.scoped(context, assignmentId);
    return this.database.$transaction(async (transaction) => {
      const removed = await transaction.staffAssignment.delete({ where: { id: assignmentId } });
      await this.audit.record(
        context,
        {
          action: 'staff-assignment.removed',
          entityType: 'staff-assignment',
          entityId: assignmentId,
          oldValue: existing,
        },
        transaction,
      );
      return removed;
    });
  }

  private async validate(
    context: SchoolContext,
    input: {
      staffId: string;
      academicYearId: string;
      classId: string;
      sectionId?: string | null;
      subjectId: string;
    },
  ) {
    const schoolId = context.schoolId;
    const [staff, academicYear, schoolClass, subject, section] = await Promise.all([
      this.database.staffProfile.findFirst({ where: { id: input.staffId, schoolId } }),
      this.database.academicYear.findFirst({ where: { id: input.academicYearId, schoolId } }),
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId, academicYearId: input.academicYearId },
      }),
      this.database.subject.findFirst({
        where: { id: input.subjectId, schoolId, academicYearId: input.academicYearId },
      }),
      input.sectionId
        ? this.database.section.findFirst({
            where: { id: input.sectionId, schoolId, classId: input.classId },
          })
        : Promise.resolve(true),
    ]);
    if (!staff || !academicYear || !schoolClass || !subject || !section) {
      throw new NotFoundException('Staff, academic year, class, section, or subject not found');
    }
    if (subject.sectionId && subject.sectionId !== input.sectionId) {
      throw new BadRequestException('This subject belongs to a different section');
    }
    if (!subject.isEnabled) {
      throw new BadRequestException('This subject is switched off for the section');
    }
  }

  /** Makes the staff member the class teacher of a section, replacing any current one. */
  private async setClassTeacher(
    transaction: Prisma.TransactionClient,
    context: SchoolContext,
    sectionId: string | null | undefined,
    staffId: string,
    academicYearId: string,
  ) {
    if (!sectionId) {
      throw new BadRequestException('Choose a section to make this teacher its class teacher');
    }
    await transaction.classTeacher.upsert({
      where: { sectionId },
      create: { schoolId: context.schoolId, academicYearId, sectionId, staffId },
      update: { staffId },
    });
  }

  private async withClassTeacher<T extends { staffId: string; sectionId: string | null }>(
    assignments: T[],
    client: Prisma.TransactionClient | DatabaseService = this.database,
  ): Promise<(T & { isClassTeacher: boolean })[]> {
    const sectionIds = [...new Set(assignments.map((item) => item.sectionId).filter((id): id is string => Boolean(id)))];
    const classTeachers = sectionIds.length
      ? await client.classTeacher.findMany({ where: { sectionId: { in: sectionIds } } })
      : [];
    const bySection = new Map(classTeachers.map((row) => [row.sectionId, row.staffId]));
    return assignments.map((item) => ({
      ...item,
      isClassTeacher: Boolean(item.sectionId) && bySection.get(item.sectionId as string) === item.staffId,
    }));
  }

  private async scoped(context: SchoolContext, assignmentId: string) {
    const existing = await this.database.staffAssignment.findFirst({
      where: { id: assignmentId, schoolId: context.schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Staff assignment not found');
    }
    return existing;
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
