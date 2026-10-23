import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HomeworkStatus, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotifyService } from '../../common/notify/notify.service';
import { CreateHomeworkDto } from './dto/create-homework.dto';
import { SubmitHomeworkDto } from './dto/submit-homework.dto';
import { UpdateHomeworkDto } from './dto/update-homework.dto';
import {
  GradeSubmissionDto,
  HomeworkQueryDto,
  ReturnSubmissionDto,
} from './dto/grade-submission.dto';

@Injectable()
export class HomeworkService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async create(authUser: SupabaseUser, input: CreateHomeworkDto) {
    const context = await this.access.schoolContext(authUser);
    const references = await this.validateReferences(context.schoolId, input);
    const teacherId = input.teacherId ?? context.staffId;
    if (!teacherId) {
      throw new BadRequestException('teacherId is required for homework');
    }
    await this.assertTeacherCanManage(context, teacherId);
    await this.assertAssignment(context.schoolId, teacherId, input);

    const homework = await this.database.homework.create({
      data: {
        schoolId: context.schoolId,
        academicYearId: references.academicYear.id,
        classId: references.schoolClass.id,
        sectionId: references.section.id,
        subjectId: references.subject.id,
        teacherId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        maxMarks: input.maxMarks ?? null,
      },
      include: this.includeRelations(false),
    });
    await this.audit.record(context, {
      action: 'homework.created',
      entityType: 'homework',
      entityId: homework.id,
      newValue: { title: homework.title, sectionId: homework.sectionId },
    });
    return homework;
  }

  async findMany(authUser: SupabaseUser, filters: HomeworkQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const visibility = await this.visibleWhere(context);
    return this.database.homework.findMany({
      where: {
        AND: [
          visibility.where,
          {
            ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
            ...(filters.classId ? { classId: filters.classId } : {}),
            ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
            ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
            ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
            ...(filters.status && filters.status in HomeworkStatus
              ? { status: filters.status as HomeworkStatus }
              : {}),
          },
        ],
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: this.includeRelations(visibility.submissionStudentIds),
      take: 500,
    });
  }

  async findOne(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.access.schoolContext(authUser);
    const visibility = await this.visibleWhere(context);
    const homework = await this.database.homework.findFirst({
      where: { AND: [{ id: homeworkId }, visibility.where] },
      include: this.includeRelations(visibility.submissionStudentIds),
    });
    if (!homework) throw new NotFoundException('Homework not found');
    return homework;
  }

  async update(
    authUser: SupabaseUser,
    homeworkId: string,
    input: UpdateHomeworkDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.manageable(context, homeworkId);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Archived homework cannot be changed');
    }

    const merged = {
      academicYearId: input.academicYearId ?? existing.academicYearId,
      classId: input.classId ?? existing.classId,
      sectionId: input.sectionId ?? existing.sectionId,
      subjectId: input.subjectId ?? existing.subjectId,
      teacherId: input.teacherId ?? existing.teacherId,
    };
    const references = await this.validateReferences(context.schoolId, merged);
    await this.assertTeacherCanManage(context, merged.teacherId);
    await this.assertAssignment(context.schoolId, merged.teacherId, merged);

    const updated = await this.database.homework.update({
      where: { id: existing.id },
      data: {
        academicYearId: references.academicYear.id,
        classId: references.schoolClass.id,
        sectionId: references.section.id,
        subjectId: references.subject.id,
        teacherId: merged.teacherId,
        title: input.title === undefined ? undefined : input.title.trim(),
        description:
          input.description === undefined ? undefined : input.description.trim() || null,
        dueDate: input.dueDate === undefined ? undefined : new Date(input.dueDate),
        maxMarks: input.maxMarks,
      },
      include: this.includeRelations(false),
    });
    await this.audit.record(context, {
      action: 'homework.updated',
      entityType: 'homework',
      entityId: existing.id,
      newValue: input,
    });
    return updated;
  }

  /** Deletes a draft. Published homework with submissions must be archived instead. */
  async remove(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.manageable(context, homeworkId);
    const submissions = await this.database.homeworkSubmission.count({ where: { homeworkId } });
    if (submissions > 0) {
      throw new ConflictException('Homework with submissions cannot be deleted; archive it instead');
    }
    await this.database.homework.delete({ where: { id: existing.id } });
    await this.audit.record(context, {
      action: 'homework.deleted',
      entityType: 'homework',
      entityId: existing.id,
      oldValue: { title: existing.title, status: existing.status },
    });
    return { id: existing.id, deleted: true };
  }

  async publish(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.manageable(context, homeworkId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException(`Homework is already ${existing.status.toLowerCase()}`);
    }
    const published = await this.database.homework.update({
      where: { id: existing.id },
      data: { status: HomeworkStatus.PUBLISHED, publishedAt: new Date() },
      include: this.includeRelations(false),
    });
    await this.audit.record(context, {
      action: 'homework.published',
      entityType: 'homework',
      entityId: existing.id,
    });
    const enrollments = await this.database.enrollment.findMany({
      where: { sectionId: existing.sectionId, academicYearId: existing.academicYearId, status: 'ACTIVE' },
      select: { studentId: true },
    });
    for (const { studentId } of enrollments) {
      await this.notify.toStudentFamily(studentId, {
        type: 'homework.assigned',
        title: `New homework: ${published.subject.name}`,
        body: published.dueDate
          ? `${published.title} (due ${published.dueDate.toISOString().slice(0, 10)})`
          : published.title,
        data: { homeworkId: existing.id },
      });
    }
    return published;
  }

  async archive(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.access.schoolContext(authUser);
    const existing = await this.manageable(context, homeworkId);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('Homework is already archived');
    }
    const archived = await this.database.homework.update({
      where: { id: existing.id },
      data: { status: HomeworkStatus.ARCHIVED },
      include: this.includeRelations(false),
    });
    await this.audit.record(context, {
      action: 'homework.archived',
      entityType: 'homework',
      entityId: existing.id,
    });
    return archived;
  }

  async findForStudent(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);

    const enrollment = await this.database.enrollment.findFirst({
      where: {
        studentId,
        schoolId: context.schoolId,
        status: 'ACTIVE',
        academicYear: { isClosed: false },
      },
      orderBy: { academicYear: { startsOn: 'desc' } },
    });
    if (!enrollment) return [];

    return this.database.homework.findMany({
      where: {
        schoolId: context.schoolId,
        academicYearId: enrollment.academicYearId,
        classId: enrollment.classId,
        sectionId: enrollment.sectionId,
        status: HomeworkStatus.PUBLISHED,
      },
      orderBy: [{ dueDate: 'asc' }, { publishedAt: 'desc' }],
      include: {
        subject: true,
        teacher: { include: { user: { select: { id: true, displayName: true } } } },
        submissions: { where: { studentId } },
      },
    });
  }

  async submissions(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.manageable(context, homeworkId);
    return this.database.homeworkSubmission.findMany({
      where: { homeworkId },
      orderBy: { submittedAt: 'asc' },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      },
    });
  }

  async submit(
    authUser: SupabaseUser,
    homeworkId: string,
    input: SubmitHomeworkDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const studentId = context.studentId;
    if (!studentId) {
      throw new ForbiddenException('Only a student can submit homework');
    }
    if (!input.content?.trim() && !input.attachmentUrl?.trim()) {
      throw new BadRequestException('Homework submission content or attachment is required');
    }

    const homework = await this.database.homework.findFirst({
      where: {
        id: homeworkId,
        schoolId: context.schoolId,
        status: HomeworkStatus.PUBLISHED,
      },
    });
    if (!homework) throw new NotFoundException('Published homework not found');

    const enrollment = await this.database.enrollment.findFirst({
      where: {
        studentId,
        schoolId: context.schoolId,
        academicYearId: homework.academicYearId,
        classId: homework.classId,
        sectionId: homework.sectionId,
        status: 'ACTIVE',
      },
    });
    if (!enrollment) {
      throw new ForbiddenException('Student is not enrolled in this homework class');
    }

    const existing = await this.database.homeworkSubmission.findUnique({
      where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
    });
    if (existing?.status === 'GRADED') {
      throw new ConflictException('This submission has already been graded');
    }
    const today = new Date(new Date().toISOString().slice(0, 10));
    const isLate = Boolean(homework.dueDate && today > homework.dueDate);

    return this.database.homeworkSubmission.upsert({
      where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
      create: {
        schoolId: context.schoolId,
        homeworkId: homework.id,
        studentId,
        content: input.content?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        isLate,
      },
      update: {
        content: input.content?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        submittedAt: new Date(),
        status: 'SUBMITTED',
        isLate,
      },
    });
  }

  async grade(
    authUser: SupabaseUser,
    homeworkId: string,
    submissionId: string,
    input: GradeSubmissionDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    const homework = await this.manageable(context, homeworkId);
    if (homework.maxMarks !== null && input.score > homework.maxMarks) {
      throw new BadRequestException(`Score cannot exceed ${homework.maxMarks}`);
    }
    const submission = await this.scopedSubmission(homeworkId, submissionId);
    const graded = await this.database.homeworkSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'GRADED',
        score: input.score,
        feedback: input.feedback?.trim() || null,
        gradedById: context.userId,
        gradedAt: new Date(),
      },
    });
    await this.audit.record(context, {
      action: 'homework.graded',
      entityType: 'homework-submission',
      entityId: submission.id,
      oldValue: { score: submission.score, status: submission.status },
      newValue: { score: input.score, status: 'GRADED' },
    });
    await this.notify.toStudentFamily(submission.studentId, {
      type: 'homework.graded',
      title: 'Homework graded',
      body: `${homework.title}: ${input.score}${homework.maxMarks !== null ? ` / ${homework.maxMarks}` : ''}`,
      data: { homeworkId, submissionId },
    });
    return graded;
  }

  async returnSubmission(
    authUser: SupabaseUser,
    homeworkId: string,
    submissionId: string,
    input: ReturnSubmissionDto,
  ) {
    const context = await this.access.schoolContext(authUser);
    await this.manageable(context, homeworkId);
    const submission = await this.scopedSubmission(homeworkId, submissionId);
    const returned = await this.database.homeworkSubmission.update({
      where: { id: submission.id },
      data: { status: 'RETURNED', feedback: input.feedback.trim(), score: null },
    });
    await this.audit.record(context, {
      action: 'homework.returned',
      entityType: 'homework-submission',
      entityId: submission.id,
      reason: input.feedback,
    });
    return returned;
  }

  private async scopedSubmission(homeworkId: string, submissionId: string) {
    const submission = await this.database.homeworkSubmission.findFirst({
      where: { id: submissionId, homeworkId },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  /**
   * Leaders see all homework; teachers their own; students and parents only published
   * homework for their children's sections, with only their own submissions.
   */
  private async visibleWhere(context: SchoolContext): Promise<{
    where: Prisma.HomeworkWhereInput;
    submissionStudentIds: string[] | true;
  }> {
    if (context.isLeader) {
      return { where: { schoolId: context.schoolId }, submissionStudentIds: true };
    }
    if (context.isTeacher && context.staffId) {
      return {
        where: { schoolId: context.schoolId, teacherId: context.staffId },
        submissionStudentIds: true,
      };
    }
    const scope = await this.access.studentScope(context);
    const ids = scope.all ? [] : scope.ids;
    const enrollments = await this.database.enrollment.findMany({
      where: { studentId: { in: ids }, status: 'ACTIVE', schoolId: context.schoolId },
      select: { sectionId: true, academicYearId: true },
    });
    return {
      where: {
        schoolId: context.schoolId,
        status: HomeworkStatus.PUBLISHED,
        OR: enrollments.length
          ? enrollments.map((e) => ({ sectionId: e.sectionId, academicYearId: e.academicYearId }))
          : [{ id: '00000000-0000-0000-0000-000000000000' }],
      },
      submissionStudentIds: ids,
    };
  }

  private async manageable(context: SchoolContext, homeworkId: string) {
    const homework = await this.database.homework.findFirst({
      where: { id: homeworkId, schoolId: context.schoolId },
    });
    if (!homework) throw new NotFoundException('Homework not found');
    await this.assertTeacherCanManage(context, homework.teacherId);
    return homework;
  }

  private async validateReferences(
    schoolId: string,
    input: {
      academicYearId: string;
      classId: string;
      sectionId: string;
      subjectId: string;
    },
  ) {
    const [academicYear, schoolClass, section, subject] = await Promise.all([
      this.database.academicYear.findFirst({
        where: { id: input.academicYearId, schoolId },
      }),
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId, academicYearId: input.academicYearId },
      }),
      this.database.section.findFirst({
        where: {
          id: input.sectionId,
          schoolId,
          academicYearId: input.academicYearId,
          classId: input.classId,
          isArchived: false,
        },
      }),
      this.database.subject.findFirst({
        where: { id: input.subjectId, schoolId, academicYearId: input.academicYearId },
      }),
    ]);
    if (!academicYear || !schoolClass || !section || !subject) {
      throw new NotFoundException(
        'Academic year, class, section, or subject not found in this school',
      );
    }
    if (academicYear.isClosed) {
      throw new BadRequestException('This academic year is closed');
    }
    return { academicYear, schoolClass, section, subject };
  }

  /** The teacher must teach this subject to the whole class or to this section. */
  private async assertAssignment(
    schoolId: string,
    staffId: string,
    input: { academicYearId: string; classId: string; sectionId: string; subjectId: string },
  ) {
    const assignment = await this.database.staffAssignment.findFirst({
      where: {
        schoolId,
        staffId,
        academicYearId: input.academicYearId,
        classId: input.classId,
        subjectId: input.subjectId,
        OR: [{ sectionId: null }, { sectionId: input.sectionId }],
      },
    });
    if (!assignment) {
      throw new ForbiddenException('Teacher is not assigned to this class, section and subject');
    }
  }

  private async assertTeacherCanManage(context: SchoolContext, teacherId: string) {
    if (!context.isLeader) {
      if (!context.isTeacher || context.staffId !== teacherId) {
        throw new ForbiddenException('Teachers can manage only their assigned homework');
      }
    }
    const teacher = await this.database.staffProfile.findFirst({
      where: { id: teacherId, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!teacher) throw new NotFoundException('Teacher not found in this school');
  }

  private includeRelations(submissionStudentIds: string[] | boolean) {
    return {
      academicYear: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true, code: true } },
      teacher: { include: { user: { select: { id: true, displayName: true } } } },
      ...(submissionStudentIds === true
        ? { submissions: true }
        : Array.isArray(submissionStudentIds)
          ? { submissions: { where: { studentId: { in: submissionStudentIds } } } }
          : {}),
    };
  }
}
