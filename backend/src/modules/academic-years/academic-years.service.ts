import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { RolloverAcademicYearDto } from './dto/rollover-academic-year.dto';

@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async create(authUser: SupabaseUser, input: CreateAcademicYearDto) {
    const context = await this.access.schoolContext(authUser);
    const dates = this.parseDates(input.startsOn, input.endsOn);
    try {
      const year = await this.database.academicYear.create({
        data: {
          schoolId: context.schoolId,
          name: input.name.trim(),
          startsOn: dates.startsOn,
          endsOn: dates.endsOn,
        },
      });
      await this.audit.record(context, {
        action: 'academic-year.created',
        entityType: 'academic-year',
        entityId: year.id,
        newValue: input,
      });
      return year;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Academic year name already exists in this school');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.academicYear.findMany({
      where: { schoolId: context.schoolId },
      orderBy: { startsOn: 'desc' },
    });
  }

  async findOne(authUser: SupabaseUser, academicYearId: string) {
    const context = await this.access.schoolContext(authUser);
    const academicYear = await this.database.academicYear.findFirst({
      where: { id: academicYearId, schoolId: context.schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }
    return academicYear;
  }

  async update(
    authUser: SupabaseUser,
    academicYearId: string,
    input: UpdateAcademicYearDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.findOne(authUser, academicYearId);
    if (existing.isClosed) {
      throw new BadRequestException('A closed academic year cannot be changed');
    }
    const startsOn = input.startsOn
      ? new Date(input.startsOn)
      : existing.startsOn;
    const endsOn = input.endsOn ? new Date(input.endsOn) : existing.endsOn;
    if (startsOn >= endsOn) {
      throw new BadRequestException('Academic year start must be before its end');
    }

    try {
      const updated = await this.database.academicYear.update({
        where: { id: existing.id },
        data: {
          name: input.name === undefined ? undefined : input.name.trim(),
          startsOn: input.startsOn ? startsOn : undefined,
          endsOn: input.endsOn ? endsOn : undefined,
        },
      });
      await this.audit.record(context, {
        action: 'academic-year.updated',
        entityType: 'academic-year',
        entityId: existing.id,
        oldValue: { name: existing.name, startsOn: existing.startsOn, endsOn: existing.endsOn },
        newValue: input,
      });
      return updated;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Academic year name already exists in this school');
      }
      throw error;
    }
  }

  async activate(authUser: SupabaseUser, academicYearId: string) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.findOne(authUser, academicYearId);
    if (existing.isClosed) {
      throw new BadRequestException('A closed academic year cannot be activated');
    }
    return this.database.$transaction(async (transaction) => {
      await transaction.academicYear.updateMany({
        where: { schoolId: context.schoolId, id: { not: existing.id } },
        data: { isActive: false },
      });
      const activated = await transaction.academicYear.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
      await this.audit.record(
        context,
        { action: 'academic-year.activated', entityType: 'academic-year', entityId: existing.id },
        transaction,
      );
      return activated;
    });
  }

  /** Closing freezes the year: no new enrollments, homework, or attendance against it. */
  async close(authUser: SupabaseUser, academicYearId: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const existing = await this.findOne(authUser, academicYearId);
    if (existing.isClosed) {
      throw new ConflictException('Academic year is already closed');
    }
    return this.database.$transaction(async (transaction) => {
      const closed = await transaction.academicYear.update({
        where: { id: existing.id },
        data: { isClosed: true, isActive: false },
      });
      await this.audit.record(
        context,
        { action: 'academic-year.closed', entityType: 'academic-year', entityId: existing.id },
        transaction,
      );
      return closed;
    });
  }

  /**
   * Tier 4 school-wide change: creates the next year, copies structure, and optionally promotes.
   * History is preserved; previous enrollments are marked PROMOTED, never overwritten.
   */
  async rollover(authUser: SupabaseUser, academicYearId: string, input: RolloverAcademicYearDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const source = await this.findOne(authUser, academicYearId);
    const dates = this.parseDates(input.startsOn, input.endsOn);
    if (dates.startsOn <= source.startsOn) {
      throw new BadRequestException('The new year must start after the source year');
    }
    const retain = new Set(input.retainStudentIds ?? []);

    const result = await this.database.$transaction(
      async (transaction) => {
        const target = await transaction.academicYear.create({
          data: {
            schoolId: context.schoolId,
            name: input.name.trim(),
            startsOn: dates.startsOn,
            endsOn: dates.endsOn,
          },
        });
        const classes = await transaction.schoolClass.findMany({
          where: { academicYearId: source.id },
          include: { sections: { where: { isArchived: false } } },
          orderBy: { sortOrder: 'asc' },
        });
        const classMap = new Map<string, string>();
        const sectionMap = new Map<string, string>();
        const sectionsByClass = new Map<string, Map<string, string>>();
        for (const schoolClass of classes) {
          const copy = await transaction.schoolClass.create({
            data: {
              schoolId: context.schoolId,
              academicYearId: target.id,
              name: schoolClass.name,
              sortOrder: schoolClass.sortOrder,
            },
          });
          classMap.set(schoolClass.id, copy.id);
          const byName = new Map<string, string>();
          for (const section of schoolClass.sections) {
            const sectionCopy = await transaction.section.create({
              data: {
                schoolId: context.schoolId,
                academicYearId: target.id,
                classId: copy.id,
                name: section.name,
              },
            });
            sectionMap.set(section.id, sectionCopy.id);
            byName.set(section.name, sectionCopy.id);
          }
          sectionsByClass.set(copy.id, byName);
        }

        const subjects = await transaction.subject.findMany({ where: { academicYearId: source.id } });
        const subjectMap = new Map<string, string>();
        for (const subject of subjects) {
          const copy = await transaction.subject.create({
            data: {
              schoolId: context.schoolId,
              academicYearId: target.id,
              name: subject.name,
              code: subject.code,
            },
          });
          subjectMap.set(subject.id, copy.id);
        }

        let assignmentsCopied = 0;
        if (input.copyAssignments) {
          const assignments = await transaction.staffAssignment.findMany({
            where: { academicYearId: source.id },
          });
          for (const assignment of assignments) {
            await transaction.staffAssignment.create({
              data: {
                schoolId: context.schoolId,
                academicYearId: target.id,
                staffId: assignment.staffId,
                classId: classMap.get(assignment.classId) as string,
                sectionId: assignment.sectionId ? sectionMap.get(assignment.sectionId) ?? null : null,
                subjectId: subjectMap.get(assignment.subjectId) as string,
                isClassTeacher: assignment.isClassTeacher,
              },
            });
            assignmentsCopied += 1;
          }
        }

        let promoted = 0;
        let retained = 0;
        let completed = 0;
        if (input.promoteStudents) {
          const order = classes.map((schoolClass) => schoolClass.id);
          const enrollments = await transaction.enrollment.findMany({
            where: { academicYearId: source.id, status: 'ACTIVE' },
            include: { section: true },
          });
          for (const enrollment of enrollments) {
            const stays = retain.has(enrollment.studentId);
            const index = order.indexOf(enrollment.classId);
            const nextOldClassId = stays ? enrollment.classId : order[index + 1];
            await transaction.enrollment.update({
              where: { id: enrollment.id },
              data: { status: 'PROMOTED' },
            });
            if (!nextOldClassId) {
              completed += 1;
              continue;
            }
            const nextClassId = classMap.get(nextOldClassId) as string;
            const sections = sectionsByClass.get(nextClassId);
            const sectionId =
              sections?.get(enrollment.section.name) ?? sections?.values().next().value;
            if (!sectionId) {
              completed += 1;
              continue;
            }
            await transaction.enrollment.create({
              data: {
                schoolId: context.schoolId,
                academicYearId: target.id,
                studentId: enrollment.studentId,
                classId: nextClassId,
                sectionId,
              },
            });
            if (stays) retained += 1;
            else promoted += 1;
          }
        }

        await this.audit.record(
          context,
          {
            action: 'academic-year.rolled-over',
            entityType: 'academic-year',
            entityId: source.id,
            newValue: { targetAcademicYearId: target.id, ...input },
          },
          transaction,
        );
        return {
          academicYear: target,
          classesCopied: classMap.size,
          sectionsCopied: sectionMap.size,
          subjectsCopied: subjectMap.size,
          assignmentsCopied,
          promoted,
          retained,
          completed,
        };
      },
      { timeout: 60000 },
    );
    return result;
  }

  async summary(authUser: SupabaseUser, academicYearId: string) {
    const context = await this.access.schoolContext(authUser);
    const year = await this.findOne(authUser, academicYearId);
    const where = { schoolId: context.schoolId, academicYearId };
    const [classes, sections, subjects, assignments, enrollmentsByStatus, examinations, homework] =
      await Promise.all([
        this.database.schoolClass.count({ where }),
        this.database.section.count({ where }),
        this.database.subject.count({ where }),
        this.database.staffAssignment.count({ where }),
        this.database.enrollment.groupBy({ by: ['status'], where, _count: { _all: true } }),
        this.database.examination.count({ where }),
        this.database.homework.count({ where }),
      ]);
    const attendance = await this.database.attendanceRecord.groupBy({
      by: ['status'],
      where: { schoolId: context.schoolId, enrollment: { academicYearId } },
      _count: { _all: true },
    });
    return {
      academicYear: year,
      classes,
      sections,
      subjects,
      staffAssignments: assignments,
      enrollments: Object.fromEntries(enrollmentsByStatus.map((row) => [row.status, row._count._all])),
      attendance: Object.fromEntries(attendance.map((row) => [row.status, row._count._all])),
      examinations,
      homework,
    };
  }

  private parseDates(startsOn: string, endsOn: string) {
    const starts = new Date(startsOn);
    const ends = new Date(endsOn);
    if (starts >= ends) {
      throw new BadRequestException('Academic year start must be before its end');
    }
    return { startsOn: starts, endsOn: ends };
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
