import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HomeworkStatus } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateHomeworkDto } from './dto/create-homework.dto';
import { SubmitHomeworkDto } from './dto/submit-homework.dto';
import { UpdateHomeworkDto } from './dto/update-homework.dto';

@Injectable()
export class HomeworkService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateHomeworkDto) {
    const context = await this.getContext(authUser);
    const references = await this.validateReferences(context.schoolId, input);
    const teacherId = input.teacherId ?? context.staffProfile?.id;
    if (!teacherId) {
      throw new BadRequestException('teacherId is required for homework');
    }
    await this.assertTeacherCanManage(context, teacherId);
    await this.assertAssignment(
      context.schoolId,
      teacherId,
      input.academicYearId,
      input.classId,
      input.subjectId,
    );

    try {
      return await this.database.homework.create({
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
        include: this.includeRelations(),
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Homework could not be created');
      }
      throw error;
    }
  }

  async findMany(
    authUser: SupabaseUser,
    filters: {
      academicYearId?: string;
      classId?: string;
      sectionId?: string;
      subjectId?: string;
      teacherId?: string;
    },
  ) {
    const context = await this.getContext(authUser);
    const teacherScope =
      this.hasRole(context, 'Teacher') && context.staffProfile
        ? { teacherId: context.staffProfile.id }
        : {};
    return this.database.homework.findMany({
      where: {
        schoolId: context.schoolId,
        ...teacherScope,
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
        ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: this.includeRelations(),
    });
  }

  async findOne(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.getContext(authUser);
    const homework = await this.database.homework.findFirst({
      where: { id: homeworkId, schoolId: context.schoolId },
      include: this.includeRelations(),
    });
    if (!homework) throw new NotFoundException('Homework not found');
    if (
      this.hasRole(context, 'Teacher') &&
      context.staffProfile?.id !== homework.teacherId
    ) {
      throw new ForbiddenException('Teachers can read only their assigned homework');
    }
    return homework;
  }

  async update(
    authUser: SupabaseUser,
    homeworkId: string,
    input: UpdateHomeworkDto,
  ) {
    const context = await this.getContext(authUser);
    const existing = await this.database.homework.findFirst({
      where: { id: homeworkId, schoolId: context.schoolId },
    });
    if (!existing) throw new NotFoundException('Homework not found');

    const merged = {
      academicYearId: input.academicYearId ?? existing.academicYearId,
      classId: input.classId ?? existing.classId,
      sectionId: input.sectionId ?? existing.sectionId,
      subjectId: input.subjectId ?? existing.subjectId,
      teacherId: input.teacherId ?? existing.teacherId,
    };
    const references = await this.validateReferences(context.schoolId, merged);
    await this.assertTeacherCanManage(context, merged.teacherId);
    await this.assertAssignment(
      context.schoolId,
      merged.teacherId,
      merged.academicYearId,
      merged.classId,
      merged.subjectId,
    );

    return this.database.homework.update({
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
      include: this.includeRelations(),
    });
  }

  async remove(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.getContext(authUser);
    const existing = await this.database.homework.findFirst({
      where: { id: homeworkId, schoolId: context.schoolId },
    });
    if (!existing) throw new NotFoundException('Homework not found');
    await this.assertTeacherCanManage(context, existing.teacherId);
    return this.database.homework.delete({ where: { id: existing.id } });
  }

  async publish(authUser: SupabaseUser, homeworkId: string) {
    const context = await this.getContext(authUser);
    const existing = await this.database.homework.findFirst({
      where: { id: homeworkId, schoolId: context.schoolId },
    });
    if (!existing) throw new NotFoundException('Homework not found');
    await this.assertTeacherCanManage(context, existing.teacherId);
    return this.database.homework.update({
      where: { id: existing.id },
      data: { status: HomeworkStatus.PUBLISHED, publishedAt: new Date() },
      include: this.includeRelations(),
    });
  }

  async findForStudent(authUser: SupabaseUser, studentId: string) {
    const context = await this.getContext(authUser);
    const student = await this.database.student.findFirst({
      where: { id: studentId, schoolId: context.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    await this.assertStudentReadAccess(context, studentId);

    const enrollment = await this.database.enrollment.findFirst({
      where: { studentId, schoolId: context.schoolId, status: 'ACTIVE' },
      orderBy: { academicYearId: 'desc' },
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

  async submit(
    authUser: SupabaseUser,
    homeworkId: string,
    input: SubmitHomeworkDto,
  ) {
    const context = await this.getContext(authUser);
    const studentId = context.studentProfile?.id;
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

    return this.database.homeworkSubmission.upsert({
      where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
      create: {
        schoolId: context.schoolId,
        homeworkId: homework.id,
        studentId,
        content: input.content?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
      },
      update: {
        content: input.content?.trim() || null,
        attachmentUrl: input.attachmentUrl?.trim() || null,
        submittedAt: new Date(),
        status: 'SUBMITTED',
      },
      include: { homework: true, student: true },
    });
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
    return { academicYear, schoolClass, section, subject };
  }

  private async assertAssignment(
    schoolId: string,
    staffId: string,
    academicYearId: string,
    classId: string,
    subjectId: string,
  ) {
    const assignment = await this.database.staffAssignment.findFirst({
      where: { schoolId, staffId, academicYearId, classId, subjectId },
    });
    if (!assignment) {
      throw new ForbiddenException('Teacher is not assigned to this class and subject');
    }
  }

  private async assertTeacherCanManage(
    context: Awaited<ReturnType<HomeworkService['getContext']>>,
    teacherId: string,
  ) {
    if (this.hasRole(context, 'Teacher') && context.staffProfile?.id !== teacherId) {
      throw new ForbiddenException('Teachers can manage only their assigned homework');
    }
    const teacher = await this.database.staffProfile.findFirst({
      where: { id: teacherId, schoolId: context.schoolId },
      select: { id: true },
    });
    if (!teacher) throw new NotFoundException('Teacher not found in this school');
  }

  private async assertStudentReadAccess(
    context: Awaited<ReturnType<HomeworkService['getContext']>>,
    studentId: string,
  ) {
    if (context.studentProfile?.id === studentId) return;
    const linkedGuardian = await this.database.studentGuardian.findFirst({
      where: { studentId, guardian: { userId: context.id } },
      select: { studentId: true },
    });
    if (
      linkedGuardian ||
      context.staffProfile ||
      this.hasRole(context, 'School Admin') ||
      this.hasRole(context, 'Principal') ||
      this.hasRole(context, 'Super Admin')
    ) {
      return;
    }
    throw new ForbiddenException('You cannot read homework for this student');
  }

  private async getContext(authUser: SupabaseUser) {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        id: true,
        schoolId: true,
        status: true,
        staffProfile: { select: { id: true } },
        studentProfile: { select: { id: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) throw new ForbiddenException('ERP user profile is required');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('ERP user is not active');
    if (!user.schoolId) throw new ForbiddenException('ERP user is not assigned to a school');
    return { ...user, schoolId: user.schoolId };
  }

  private hasRole(
    context: Awaited<ReturnType<HomeworkService['getContext']>>,
    name: string,
  ) {
    return context.roles.some((userRole) => userRole.role.name === name);
  }

  private includeRelations() {
    return {
      academicYear: true,
      class: true,
      section: true,
      subject: true,
      teacher: { include: { user: { select: { id: true, displayName: true, email: true } } } },
      submissions: true,
    };
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
