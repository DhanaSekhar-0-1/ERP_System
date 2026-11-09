import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { defaultSubjects, subjectCode } from '../../common/academics/default-subjects';
import {
  CreateSectionSubjectDto,
  DefaultSubjectsDto,
  UpdateSectionSubjectDto,
} from './dto/academics.dto';

const STAFF_NAME = { select: { id: true, employeeNo: true, user: { select: { displayName: true } } } } as const;

/**
 * Class, section, subject and teacher-assignment management. Each section keeps its own copy of
 * its subjects, and each section has at most one class teacher. A teacher's access is worked out
 * from these rows on every request, so removing an assignment removes the access immediately.
 */
@Injectable()
export class AcademicsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Classes of a year with their section, subject and teacher counts, for the class cards. */
  async overview(authUser: SupabaseUser, academicYearId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.year(context, academicYearId);
    const classes = await this.database.schoolClass.findMany({
      where: { schoolId: context.schoolId, academicYearId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        sections: {
          where: { isArchived: false },
          select: {
            id: true,
            _count: { select: { subjects: { where: { isEnabled: true } }, enrollments: { where: { status: 'ACTIVE' } } } },
          },
        },
        assignments: { select: { staffId: true } },
      },
    });
    const classTeachers = await this.database.classTeacher.findMany({
      where: { schoolId: context.schoolId, academicYearId },
      select: { staffId: true, section: { select: { classId: true } } },
    });
    return classes.map((schoolClass) => {
      const teachers = new Set(schoolClass.assignments.map((row) => row.staffId));
      classTeachers
        .filter((row) => row.section.classId === schoolClass.id)
        .forEach((row) => teachers.add(row.staffId));
      return {
        id: schoolClass.id,
        name: schoolClass.name,
        sortOrder: schoolClass.sortOrder,
        academicYearId: schoolClass.academicYearId,
        sections: schoolClass.sections.length,
        subjects: schoolClass.sections.reduce((sum, section) => sum + section._count.subjects, 0),
        teachers: teachers.size,
        students: schoolClass.sections.reduce((sum, section) => sum + section._count.enrollments, 0),
      };
    });
  }

  /** One class with each section's subjects, subject teachers, class teacher and student count. */
  async classDetail(authUser: SupabaseUser, classId: string) {
    const context = await this.access.schoolContext(authUser);
    const schoolClass = await this.database.schoolClass.findFirst({
      where: { id: classId, schoolId: context.schoolId },
      include: {
        sections: {
          where: { isArchived: false },
          orderBy: { name: 'asc' },
          include: {
            subjects: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: { assignments: { include: { staff: STAFF_NAME } } },
            },
            classTeacher: { include: { staff: STAFF_NAME } },
            _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
          },
        },
      },
    });
    if (!schoolClass) throw new NotFoundException('Class not found');
    return {
      id: schoolClass.id,
      name: schoolClass.name,
      sortOrder: schoolClass.sortOrder,
      academicYearId: schoolClass.academicYearId,
      sections: schoolClass.sections.map((section) => ({
        id: section.id,
        name: section.name,
        students: section._count.enrollments,
        classTeacher: section.classTeacher ? this.staffSummary(section.classTeacher.staff) : null,
        subjects: section.subjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          code: subject.code,
          isOptional: subject.isOptional,
          isEnabled: subject.isEnabled,
          teachers: subject.assignments
            .filter((assignment) => assignment.sectionId === section.id)
            .map((assignment) => ({ assignmentId: assignment.id, ...this.staffSummary(assignment.staff) })),
        })),
      })),
    };
  }

  /** Students enrolled in a section, for the class details Students tab. */
  async sectionStudents(authUser: SupabaseUser, sectionId: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const section = await this.section(context, sectionId);
    return this.database.enrollment.findMany({
      where: { sectionId: section.id, status: 'ACTIVE' },
      orderBy: [{ rollNumber: 'asc' }],
      select: {
        id: true,
        rollNumber: true,
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      },
    });
  }

  /**
   * Deletes a class with its sections, subjects and teacher assignments. Refused while the class
   * has students, exams, homework, fees, timetables or announcements, so no records are lost.
   */
  async deleteClass(authUser: SupabaseUser, classId: string) {
    const context = await this.admin(authUser);
    const schoolClass = await this.database.schoolClass.findFirst({
      where: { id: classId, schoolId: context.schoolId },
      include: { sections: { select: { id: true } } },
    });
    if (!schoolClass) throw new NotFoundException('Class not found');
    const sectionIds = schoolClass.sections.map((section) => section.id);
    const blockers = await this.dependents({ classId, sectionIds });
    if (blockers.length) {
      throw new ConflictException(`Class ${schoolClass.name} still has ${blockers.join(', ')}. Move or remove them first.`);
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.staffAssignment.deleteMany({ where: { classId } });
      await transaction.classTeacher.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await transaction.subject.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await transaction.section.deleteMany({ where: { classId } });
      await transaction.schoolClass.delete({ where: { id: classId } });
      await this.audit.record(
        context,
        { action: 'class.deleted', entityType: 'class', entityId: classId, oldValue: { name: schoolClass.name } },
        transaction,
      );
    });
    return { id: classId, deleted: true };
  }

  /** Deletes a section with its subjects and teacher assignments. A class keeps at least one section. */
  async deleteSection(authUser: SupabaseUser, sectionId: string) {
    const context = await this.admin(authUser);
    const section = await this.section(context, sectionId);
    const remaining = await this.database.section.count({
      where: { classId: section.classId, isArchived: false, id: { not: section.id } },
    });
    if (!remaining) {
      throw new ConflictException('A class must keep at least one section');
    }
    const blockers = await this.dependents({ sectionIds: [section.id] });
    if (blockers.length) {
      throw new ConflictException(`Section ${section.name} still has ${blockers.join(', ')}. Move or remove them first.`);
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.staffAssignment.deleteMany({ where: { sectionId: section.id } });
      await transaction.classTeacher.deleteMany({ where: { sectionId: section.id } });
      await transaction.subject.deleteMany({ where: { sectionId: section.id } });
      await transaction.section.delete({ where: { id: section.id } });
      await this.audit.record(
        context,
        { action: 'section.deleted', entityType: 'section', entityId: section.id, oldValue: { name: section.name, classId: section.classId } },
        transaction,
      );
    });
    return { id: section.id, deleted: true };
  }

  async sectionSubjects(authUser: SupabaseUser, sectionId: string) {
    const context = await this.access.schoolContext(authUser);
    const section = await this.section(context, sectionId);
    return this.database.subject.findMany({
      where: { sectionId: section.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async addSubject(authUser: SupabaseUser, sectionId: string, input: CreateSectionSubjectDto) {
    const context = await this.admin(authUser);
    const section = await this.section(context, sectionId);
    const last = await this.database.subject.aggregate({ where: { sectionId }, _max: { sortOrder: true } });
    const subject = await this.unique(
      () =>
        this.database.subject.create({
          data: {
            schoolId: context.schoolId,
            academicYearId: section.academicYearId,
            sectionId: section.id,
            name: input.name.trim(),
            code: (input.code?.trim() || subjectCode(input.name)).toUpperCase(),
            isOptional: input.isOptional ?? false,
            isEnabled: true,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
        }),
      'This section already has a subject with that code',
    );
    await this.audit.record(context, {
      action: 'subject.created',
      entityType: 'subject',
      entityId: subject.id,
      newValue: { sectionId, name: subject.name, code: subject.code, isOptional: subject.isOptional },
    });
    return subject;
  }

  /** Renames a section's subject, changes its code, or switches it on or off. Other sections are not touched. */
  async updateSubject(authUser: SupabaseUser, subjectId: string, input: UpdateSectionSubjectDto) {
    const context = await this.admin(authUser);
    const subject = await this.subject(context, subjectId);
    if (input.isEnabled === false && !subject.isOptional && input.isOptional !== true) {
      throw new BadRequestException('Only optional subjects can be switched off; remove the subject instead');
    }
    const updated = await this.unique(
      () =>
        this.database.$transaction(async (transaction) => {
          const result = await transaction.subject.update({
            where: { id: subject.id },
            data: {
              name: input.name?.trim(),
              code: input.code?.trim().toUpperCase(),
              isOptional: input.isOptional,
              isEnabled: input.isEnabled,
            },
          });
          // A switched-off subject has no teachers, so their access to it ends now.
          if (input.isEnabled === false) {
            await transaction.staffAssignment.deleteMany({ where: { subjectId: subject.id } });
          }
          await this.audit.record(
            context,
            {
              action: 'subject.updated',
              entityType: 'subject',
              entityId: subject.id,
              oldValue: { name: subject.name, code: subject.code, isOptional: subject.isOptional, isEnabled: subject.isEnabled },
              newValue: input,
            },
            transaction,
          );
          return result;
        }),
      'This section already has a subject with that code',
    );
    return updated;
  }

  /** Removes a section's subject and its teacher assignments. Refused once exams, homework or a timetable use it. */
  async deleteSubject(authUser: SupabaseUser, subjectId: string) {
    const context = await this.admin(authUser);
    const subject = await this.subject(context, subjectId);
    const [assessments, homework, slots] = await Promise.all([
      this.database.assessment.count({ where: { subjectId } }),
      this.database.homework.count({ where: { subjectId } }),
      this.database.timetableSlot.count({ where: { subjectId } }),
    ]);
    const blockers = this.describe({ 'exam subject': assessments, 'homework item': homework, 'timetable period': slots });
    if (blockers.length) {
      throw new ConflictException(
        `${subject.name} is used by ${blockers.join(', ')}. ${subject.isOptional ? 'Switch it off' : 'Keep it'} instead of removing it.`,
      );
    }
    await this.database.$transaction(async (transaction) => {
      await transaction.staffAssignment.deleteMany({ where: { subjectId } });
      await transaction.subject.delete({ where: { id: subjectId } });
      await this.audit.record(
        context,
        { action: 'subject.deleted', entityType: 'subject', entityId: subjectId, oldValue: { name: subject.name, sectionId: subject.sectionId } },
        transaction,
      );
    });
    return { id: subjectId, deleted: true };
  }

  /** Sets, changes or removes the one teacher of a section's subject. */
  async setSubjectTeacher(authUser: SupabaseUser, subjectId: string, staffId?: string | null) {
    const context = await this.assignmentManager(authUser);
    const subject = await this.subject(context, subjectId);
    if (!subject.sectionId) {
      throw new BadRequestException('Assign teachers to section subjects');
    }
    if (staffId) {
      if (!subject.isEnabled) throw new BadRequestException('Switch this subject on before assigning a teacher');
      await this.staff(context, staffId);
    }
    const section = await this.section(context, subject.sectionId);
    const previous = await this.database.staffAssignment.findMany({
      where: { subjectId, sectionId: section.id },
      select: { id: true, staffId: true },
    });
    await this.database.$transaction(async (transaction) => {
      await transaction.staffAssignment.deleteMany({ where: { subjectId, sectionId: section.id } });
      if (staffId) {
        await transaction.staffAssignment.create({
          data: {
            schoolId: context.schoolId,
            academicYearId: section.academicYearId,
            staffId,
            classId: section.classId,
            sectionId: section.id,
            subjectId,
          },
        });
      }
      await this.audit.record(
        context,
        {
          action: staffId ? 'subject-teacher.assigned' : 'subject-teacher.removed',
          entityType: 'subject',
          entityId: subjectId,
          oldValue: { staffIds: previous.map((row) => row.staffId) },
          newValue: { staffId: staffId ?? null, sectionId: section.id },
        },
        transaction,
      );
    });
    return this.subjectTeachers(subjectId);
  }

  /** Sets, changes or removes the class teacher of a section. One per section. */
  async setClassTeacher(authUser: SupabaseUser, sectionId: string, staffId?: string | null) {
    const context = await this.assignmentManager(authUser);
    const section = await this.section(context, sectionId);
    if (staffId) await this.staff(context, staffId);
    const previous = await this.database.classTeacher.findUnique({ where: { sectionId: section.id } });
    await this.database.$transaction(async (transaction) => {
      if (staffId) {
        await transaction.classTeacher.upsert({
          where: { sectionId: section.id },
          create: { schoolId: context.schoolId, academicYearId: section.academicYearId, sectionId: section.id, staffId },
          update: { staffId },
        });
      } else {
        await transaction.classTeacher.deleteMany({ where: { sectionId: section.id } });
      }
      await this.audit.record(
        context,
        {
          action: staffId ? 'class-teacher.assigned' : 'class-teacher.removed',
          entityType: 'section',
          entityId: section.id,
          oldValue: { staffId: previous?.staffId ?? null },
          newValue: { staffId: staffId ?? null },
        },
        transaction,
      );
    });
    const current = await this.database.classTeacher.findUnique({
      where: { sectionId: section.id },
      include: { staff: STAFF_NAME },
    });
    return { sectionId: section.id, classTeacher: current ? this.staffSummary(current.staff) : null };
  }

  /** Every subject assignment and class teacher in a year, for the Teacher Assignments page. */
  async assignments(authUser: SupabaseUser, academicYearId: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    await this.year(context, academicYearId);
    const sections = await this.database.section.findMany({
      where: { schoolId: context.schoolId, academicYearId, isArchived: false },
      orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: {
        class: { select: { id: true, name: true } },
        classTeacher: { include: { staff: STAFF_NAME } },
        subjects: {
          where: { isEnabled: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { assignments: { include: { staff: STAFF_NAME } } },
        },
      },
    });
    return sections.map((section) => ({
      sectionId: section.id,
      sectionName: section.name,
      class: section.class,
      classTeacher: section.classTeacher ? this.staffSummary(section.classTeacher.staff) : null,
      subjects: section.subjects.map((subject) => ({
        subjectId: subject.id,
        name: subject.name,
        isOptional: subject.isOptional,
        teacher: subject.assignments[0] ? this.staffSummary(subject.assignments[0].staff) : null,
      })),
    }));
  }

  async getDefaultSubjects(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return defaultSubjects(this.database, context.schoolId);
  }

  /** Saves the school's default subject list. Used for sections created from now on; existing sections keep theirs. */
  async setDefaultSubjects(authUser: SupabaseUser, input: DefaultSubjectsDto) {
    const context = await this.admin(authUser);
    const subjects = input.subjects.map((subject) => ({
      name: subject.name.trim(),
      code: (subject.code?.trim() || subjectCode(subject.name)).toUpperCase(),
      isOptional: subject.isOptional ?? false,
    }));
    const codes = subjects.map((subject) => subject.code);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('Each default subject needs a different code');
    }
    const settings = await this.database.schoolSettings.findUnique({ where: { schoolId: context.schoolId } });
    const metadata = { ...((settings?.metadata as Record<string, unknown> | null) ?? {}), defaultSubjects: subjects };
    await this.database.schoolSettings.upsert({
      where: { schoolId: context.schoolId },
      create: { schoolId: context.schoolId, metadata },
      update: { metadata },
    });
    await this.audit.record(context, {
      action: 'default-subjects.updated',
      entityType: 'school',
      entityId: context.schoolId,
      newValue: { subjects },
    });
    return subjects;
  }

  /** What the signed-in teacher teaches and where they are class teacher, in the active year. */
  async myTeaching(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.staffId) {
      return { academicYear: null, subjects: [], classTeacherOf: [] };
    }
    const year = await this.database.academicYear.findFirst({
      where: { schoolId: context.schoolId, isActive: true },
      select: { id: true, name: true },
    });
    if (!year) return { academicYear: null, subjects: [], classTeacherOf: [] };
    const [assignments, classTeacherOf] = await Promise.all([
      this.database.staffAssignment.findMany({
        where: { staffId: context.staffId, academicYearId: year.id },
        include: {
          class: { select: { id: true, name: true, sortOrder: true } },
          section: { select: { id: true, name: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } },
          subject: { select: { id: true, name: true, code: true } },
        },
      }),
      this.database.classTeacher.findMany({
        where: { staffId: context.staffId, academicYearId: year.id },
        include: {
          section: {
            select: {
              id: true,
              name: true,
              class: { select: { id: true, name: true } },
              _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
            },
          },
        },
      }),
    ]);
    return {
      academicYear: year,
      subjects: assignments
        .sort((a, b) => a.class.sortOrder - b.class.sortOrder || (a.section?.name ?? '').localeCompare(b.section?.name ?? ''))
        .map((assignment) => ({
          assignmentId: assignment.id,
          class: { id: assignment.class.id, name: assignment.class.name },
          section: assignment.section ? { id: assignment.section.id, name: assignment.section.name } : null,
          subject: assignment.subject,
          students: assignment.section?._count.enrollments ?? null,
        })),
      classTeacherOf: classTeacherOf.map((row) => ({
        section: { id: row.section.id, name: row.section.name },
        class: row.section.class,
        students: row.section._count.enrollments,
      })),
    };
  }

  // ---------- helpers ----------

  /** Structure changes are for the School Admin and Super Admin. */
  private async admin(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can change classes, sections and subjects');
    return context;
  }

  private async assignmentManager(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can assign teachers');
    return context;
  }

  private async year(context: SchoolContext, academicYearId: string) {
    const year = await this.database.academicYear.findFirst({ where: { id: academicYearId, schoolId: context.schoolId } });
    if (!year) throw new NotFoundException('Academic year not found');
    return year;
  }

  private async section(context: SchoolContext, sectionId: string) {
    const section = await this.database.section.findFirst({ where: { id: sectionId, schoolId: context.schoolId } });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  private async subject(context: SchoolContext, subjectId: string) {
    const subject = await this.database.subject.findFirst({ where: { id: subjectId, schoolId: context.schoolId } });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  private async staff(context: SchoolContext, staffId: string) {
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
      include: { user: { select: { status: true } } },
    });
    if (!staff) throw new NotFoundException('Teacher not found');
    if (staff.user.status !== 'ACTIVE') throw new BadRequestException('This teacher is not active');
    return staff;
  }

  private async subjectTeachers(subjectId: string) {
    const subject = await this.database.subject.findUniqueOrThrow({
      where: { id: subjectId },
      include: { assignments: { include: { staff: STAFF_NAME } } },
    });
    return {
      subjectId,
      teachers: subject.assignments.map((assignment) => ({ assignmentId: assignment.id, ...this.staffSummary(assignment.staff) })),
    };
  }

  private staffSummary(staff: { id: string; employeeNo: string; user: { displayName: string } }) {
    return { staffId: staff.id, employeeNo: staff.employeeNo, displayName: staff.user.displayName };
  }

  /** Records that would be lost or orphaned by deleting these sections or this class. */
  private async dependents(scope: { classId?: string; sectionIds: string[] }) {
    const bySection = { in: scope.sectionIds };
    const classOrSection: { classId: string } | { sectionId: { in: string[] } } = scope.classId
      ? { classId: scope.classId }
      : { sectionId: bySection };
    const [enrollments, assessments, homework, timetables, fees] = await Promise.all([
      this.database.enrollment.count({ where: { sectionId: bySection } }),
      this.database.assessment.count({
        where: scope.classId ? { classId: scope.classId } : { OR: [{ sectionId: bySection }, { subject: { sectionId: bySection } }] },
      }),
      this.database.homework.count({ where: classOrSection as Prisma.HomeworkWhereInput }),
      this.database.timetable.count({ where: { sectionId: bySection } }),
      scope.classId ? this.database.feeStructure.count({ where: { classId: scope.classId } }) : Promise.resolve(0),
    ]);
    return this.describe({
      'student enrollment': enrollments,
      'exam subject': assessments,
      'homework item': homework,
      timetable: timetables,
      'fee structure': fees,
    });
  }

  private describe(counts: Record<string, number>) {
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`);
  }

  private async unique<T>(run: () => Promise<T>, message: string): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(message);
      }
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}
