import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Assessment, ExamStatus, Examination, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { NotifyService } from '../../common/notify/notify.service';
import {
  BulkMarksDto,
  CreateAssessmentDto,
  CreateExaminationDto,
  CreateMarkDto,
  MarkCorrectionDto,
  MarkEntryDto,
  MarksQueryDto,
  RereleaseRequestDto,
  UpdateExaminationDto,
  UpdateMarkDto,
} from './dto/examinations.dto';

const MARK_CORRECTION = 'marks.correction';
const RERELEASE = 'examination.rerelease';

/** CBSE-style grade bands used on report cards. */
const GRADE_BANDS: [number, string][] = [
  [91, 'A1'],
  [81, 'A2'],
  [71, 'B1'],
  [61, 'B2'],
  [51, 'C1'],
  [41, 'C2'],
  [33, 'D'],
  [0, 'E'],
];

const NEXT_STATUS: Record<string, { from: ExamStatus; to: ExamStatus }> = {
  verify: { from: 'DRAFT', to: 'VERIFIED' },
  lock: { from: 'VERIFIED', to: 'LOCKED' },
  release: { from: 'LOCKED', to: 'RELEASED' },
  unlock: { from: 'LOCKED', to: 'DRAFT' },
  reject: { from: 'VERIFIED', to: 'DRAFT' },
};

@Injectable()
export class ExaminationsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalEngine,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(MARK_CORRECTION, {
      onApproved: async (transaction, request, approver) => {
        const change = request.payload as {
          marksObtained?: number | null;
          isAbsent?: boolean;
          remarks?: string;
        };
        const before = await transaction.mark.findUniqueOrThrow({ where: { id: request.entityId } });
        await transaction.mark.update({
          where: { id: request.entityId },
          data: {
            marksObtained: change.isAbsent ? null : change.marksObtained,
            isAbsent: change.isAbsent,
            remarks: change.remarks,
          },
        });
        await this.audit.record(
          approver,
          {
            action: 'marks.corrected',
            entityType: 'mark',
            entityId: request.entityId,
            oldValue: { marksObtained: before.marksObtained, isAbsent: before.isAbsent },
            newValue: change,
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
    });
    this.approvals.register(RERELEASE, {
      onApproved: async (transaction, request, approver) => {
        await transaction.examination.update({
          where: { id: request.entityId },
          data: { status: 'DRAFT', releasedAt: null, lockedAt: null, verifiedAt: null },
        });
        await transaction.mark.updateMany({
          where: { assessment: { examinationId: request.entityId } },
          data: { status: 'DRAFT' },
        });
        await this.audit.record(
          approver,
          {
            action: 'examination.reopened',
            entityType: 'examination',
            entityId: request.entityId,
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
    });
  }

  // ---------- Examinations ----------

  async create(authUser: SupabaseUser, input: CreateExaminationDto) {
    const context = await this.leader(authUser);
    const year = await this.database.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: context.schoolId },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    if (year.isClosed) throw new BadRequestException('This academic year is closed');
    const exam = await this.database.examination.create({
      data: {
        schoolId: context.schoolId,
        academicYearId: input.academicYearId,
        name: input.name.trim(),
        term: input.term?.trim() || null,
        startsOn: input.startsOn ? new Date(input.startsOn) : null,
        endsOn: input.endsOn ? new Date(input.endsOn) : null,
      },
    });
    await this.audit.record(context, {
      action: 'examination.created',
      entityType: 'examination',
      entityId: exam.id,
      newValue: input,
    });
    return exam;
  }

  async findMany(authUser: SupabaseUser, academicYearId?: string) {
    const context = await this.access.schoolContext(authUser);
    const released = !context.isLeader && !context.isTeacher;
    return this.database.examination.findMany({
      where: {
        schoolId: context.schoolId,
        ...(academicYearId ? { academicYearId } : {}),
        ...(released ? { status: 'RELEASED' } : {}),
      },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { assessments: true } } },
    });
  }

  async findOne(authUser: SupabaseUser, examinationId: string) {
    const context = await this.access.schoolContext(authUser);
    const exam = await this.database.examination.findFirst({
      where: {
        id: examinationId,
        schoolId: context.schoolId,
        ...(!context.isLeader && !context.isTeacher ? { status: 'RELEASED' } : {}),
      },
      include: {
        assessments: {
          include: {
            class: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException('Examination not found');
    return exam;
  }

  async update(authUser: SupabaseUser, examinationId: string, input: UpdateExaminationDto) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    if (exam.status !== 'DRAFT') {
      throw new ConflictException('Only draft examinations can be edited');
    }
    const updated = await this.database.examination.update({
      where: { id: exam.id },
      data: {
        name: input.name?.trim(),
        term: input.term === undefined ? undefined : input.term.trim() || null,
        startsOn: input.startsOn ? new Date(input.startsOn) : undefined,
        endsOn: input.endsOn ? new Date(input.endsOn) : undefined,
      },
    });
    await this.audit.record(context, {
      action: 'examination.updated',
      entityType: 'examination',
      entityId: exam.id,
      newValue: input,
    });
    return updated;
  }

  async addAssessment(authUser: SupabaseUser, examinationId: string, input: CreateAssessmentDto) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    if (exam.status !== 'DRAFT') {
      throw new ConflictException('Assessments can be added only to draft examinations');
    }
    const [schoolClass, subject] = await Promise.all([
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId: context.schoolId, academicYearId: exam.academicYearId },
      }),
      this.database.subject.findFirst({
        where: { id: input.subjectId, schoolId: context.schoolId, academicYearId: exam.academicYearId },
      }),
    ]);
    if (!schoolClass || !subject) {
      throw new NotFoundException('Class or subject not found in the examination year');
    }
    if (input.passMarks !== undefined && input.passMarks > input.maxMarks) {
      throw new BadRequestException('Pass marks cannot exceed maximum marks');
    }
    return this.database.assessment.create({
      data: {
        schoolId: context.schoolId,
        examinationId,
        classId: input.classId,
        subjectId: input.subjectId,
        maxMarks: input.maxMarks,
        passMarks: input.passMarks ?? null,
        examDate: input.examDate ? new Date(input.examDate) : null,
      },
      include: { class: true, subject: true },
    });
  }

  async transition(authUser: SupabaseUser, examinationId: string, action: string, note?: string) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    const step = NEXT_STATUS[action];
    if (exam.status !== step.from) {
      throw new ConflictException(
        `Cannot ${action} an examination that is ${exam.status.toLowerCase()}`,
      );
    }
    if (action === 'verify') {
      const verification = await this.verificationData(context, exam);
      if (verification.missing > 0 || verification.unsubmitted > 0) {
        throw new ConflictException(
          `Cannot verify: ${verification.missing} marks missing and ${verification.unsubmitted} not submitted`,
        );
      }
    }
    if (action === 'release' && !context.isPrincipal && !context.isSuperAdmin && !context.isSchoolAdmin) {
      throw new ForbiddenException('Only the Principal or School Admin can release results');
    }
    const now = new Date();
    const data: Prisma.ExaminationUpdateInput = { status: step.to };
    if (action === 'verify') Object.assign(data, { verifiedAt: now, verifiedById: context.userId });
    if (action === 'lock') Object.assign(data, { lockedAt: now });
    if (action === 'release') Object.assign(data, { releasedAt: now, releasedById: context.userId });
    const updated = await this.database.$transaction(async (transaction) => {
      const result = await transaction.examination.update({ where: { id: exam.id }, data });
      if (action === 'reject' || action === 'unlock') {
        await transaction.mark.updateMany({
          where: { assessment: { examinationId: exam.id } },
          data: { status: 'DRAFT' },
        });
      }
      await this.audit.record(
        context,
        {
          action: `examination.${action}`,
          entityType: 'examination',
          entityId: exam.id,
          oldValue: { status: exam.status },
          newValue: { status: step.to },
          reason: note,
        },
        transaction,
      );
      return result;
    });
    if (action === 'release') {
      await this.notifyRelease(context, exam);
    }
    return updated;
  }

  async rereleaseRequest(authUser: SupabaseUser, examinationId: string, input: RereleaseRequestDto) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    if (exam.status !== 'RELEASED') {
      throw new ConflictException('Only released examinations can be reopened');
    }
    return this.approvals.create(context, {
      type: RERELEASE,
      entityType: 'examination',
      entityId: exam.id,
      reason: input.reason,
      tier: 4,
      documentFileId: input.documentFileId,
    });
  }

  async verification(authUser: SupabaseUser, examinationId: string) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    return this.verificationData(context, exam);
  }

  // ---------- Marks ----------

  async findMarks(authUser: SupabaseUser, query: MarksQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const where: Prisma.MarkWhereInput = {
      schoolId: context.schoolId,
      ...(query.assessmentId ? { assessmentId: query.assessmentId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.examinationId ? { assessment: { examinationId: query.examinationId } } : {}),
    };
    const scoped: Prisma.MarkWhereInput[] = [where];
    if (!context.isLeader) {
      if (context.isTeacher) {
        scoped.push({ OR: await this.teacherMarkScope(context) });
      } else {
        const scope = await this.access.studentScope(context);
        scoped.push({
          studentId: { in: scope.all ? [] : scope.ids },
          assessment: { examination: { status: 'RELEASED' } },
        });
      }
    }
    return this.database.mark.findMany({
      where: { AND: scoped },
      orderBy: [{ assessmentId: 'asc' }, { createdAt: 'asc' }],
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        assessment: {
          include: {
            subject: { select: { id: true, name: true, code: true } },
            examination: { select: { id: true, name: true, status: true } },
          },
        },
      },
      take: 2000,
    });
  }

  async findMark(authUser: SupabaseUser, markId: string) {
    const marks = await this.findMarks(authUser, {});
    const mark = marks.find((entry) => entry.id === markId);
    if (!mark) throw new NotFoundException('Mark not found');
    return mark;
  }

  async createMark(authUser: SupabaseUser, input: CreateMarkDto) {
    const context = await this.access.schoolContext(authUser);
    const assessment = await this.editableAssessment(context, input.assessmentId);
    return this.saveMark(context, assessment, input);
  }

  async bulkMarks(authUser: SupabaseUser, input: BulkMarksDto) {
    const context = await this.access.schoolContext(authUser);
    const assessment = await this.editableAssessment(context, input.assessmentId);
    const results = [];
    for (const entry of input.marks) {
      try {
        const mark = await this.saveMark(context, assessment, entry);
        results.push({ studentId: entry.studentId, result: 'saved', id: mark.id });
      } catch (error) {
        results.push({
          studentId: entry.studentId,
          result: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return {
      saved: results.filter((r) => r.result === 'saved').length,
      failed: results.filter((r) => r.result === 'failed').length,
      results,
    };
  }

  async updateMark(authUser: SupabaseUser, markId: string, input: UpdateMarkDto) {
    const context = await this.access.schoolContext(authUser);
    const mark = await this.database.mark.findFirst({
      where: { id: markId, schoolId: context.schoolId },
    });
    if (!mark) throw new NotFoundException('Mark not found');
    const assessment = await this.editableAssessment(context, mark.assessmentId);
    if (mark.status === 'SUBMITTED' && !context.isLeader) {
      throw new ConflictException('Submitted marks need a correction request');
    }
    return this.saveMark(context, assessment, {
      studentId: mark.studentId,
      marksObtained: input.marksObtained ?? (mark.marksObtained === null ? undefined : Number(mark.marksObtained)),
      isAbsent: input.isAbsent ?? mark.isAbsent,
      remarks: input.remarks ?? mark.remarks ?? undefined,
    });
  }

  /** Submits every draft mark the caller entered or may manage for the assessment. */
  async submitMarks(authUser: SupabaseUser, assessmentId: string) {
    const context = await this.access.schoolContext(authUser);
    const assessment = await this.editableAssessment(context, assessmentId);
    const studentIds = await this.manageableStudentIds(context, assessment);
    const result = await this.database.mark.updateMany({
      where: {
        assessmentId,
        status: 'DRAFT',
        ...(studentIds === true ? {} : { studentId: { in: studentIds } }),
      },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await this.audit.record(context, {
      action: 'marks.submitted',
      entityType: 'assessment',
      entityId: assessmentId,
      newValue: { submitted: result.count },
    });
    return { assessmentId, submitted: result.count };
  }

  async requestCorrection(authUser: SupabaseUser, markId: string, input: MarkCorrectionDto) {
    const context = await this.access.schoolContext(authUser);
    const mark = await this.database.mark.findFirst({
      where: { id: markId, schoolId: context.schoolId },
      include: { assessment: { include: { examination: true } } },
    });
    if (!mark) throw new NotFoundException('Mark not found');
    await this.assertCanManageStudent(context, mark.assessment, mark.studentId);
    if (input.marksObtained !== undefined && input.marksObtained > Number(mark.assessment.maxMarks)) {
      throw new BadRequestException(`Marks cannot exceed ${mark.assessment.maxMarks}`);
    }
    const released = mark.assessment.examination.status === 'RELEASED';
    const payload = {
      marksObtained: input.marksObtained,
      isAbsent: input.isAbsent,
      remarks: input.remarks,
      previous: { marksObtained: mark.marksObtained, isAbsent: mark.isAbsent },
    };
    const request = await this.approvals.create(context, {
      type: MARK_CORRECTION,
      entityType: 'mark',
      entityId: mark.id,
      reason: input.reason,
      payload,
      tier: released ? 4 : 3,
      documentFileId: input.documentFileId,
    });
    return { tier: released ? 4 : 3, approvalRequest: request };
  }

  async reportCards(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    const marks = await this.database.mark.findMany({
      where: {
        studentId,
        schoolId: context.schoolId,
        assessment: { examination: { status: 'RELEASED' } },
      },
      include: {
        assessment: {
          include: {
            subject: { select: { id: true, name: true, code: true } },
            examination: { select: { id: true, name: true, term: true, releasedAt: true, academicYearId: true } },
          },
        },
      },
    });
    const byExam = new Map<string, typeof marks>();
    for (const mark of marks) {
      const list = byExam.get(mark.assessment.examinationId) ?? [];
      list.push(mark);
      byExam.set(mark.assessment.examinationId, list);
    }
    return [...byExam.values()].map((examMarks) => {
      const exam = examMarks[0].assessment.examination;
      const subjects = examMarks.map((mark) => {
        const max = Number(mark.assessment.maxMarks);
        const obtained = mark.isAbsent ? 0 : Number(mark.marksObtained ?? 0);
        const percent = Math.round((obtained / max) * 1000) / 10;
        const pass = mark.assessment.passMarks === null ? max * 0.33 : Number(mark.assessment.passMarks);
        return {
          subject: mark.assessment.subject,
          maxMarks: max,
          marksObtained: mark.isAbsent ? null : obtained,
          isAbsent: mark.isAbsent,
          percent,
          grade: this.grade(percent),
          passed: !mark.isAbsent && obtained >= pass,
          remarks: mark.remarks,
        };
      });
      const total = subjects.reduce((sum, subject) => sum + (subject.marksObtained ?? 0), 0);
      const max = subjects.reduce((sum, subject) => sum + subject.maxMarks, 0);
      const percent = max ? Math.round((total / max) * 1000) / 10 : 0;
      return {
        examination: exam,
        subjects,
        total,
        maxTotal: max,
        percent,
        grade: this.grade(percent),
        result: subjects.every((subject) => subject.passed) ? 'PASS' : 'NEEDS IMPROVEMENT',
      };
    });
  }

  // ---------- Helpers ----------

  private grade(percent: number): string {
    return GRADE_BANDS.find(([minimum]) => percent >= minimum)?.[1] ?? 'E';
  }

  private async saveMark(
    context: SchoolContext,
    assessment: Assessment,
    entry: MarkEntryDto,
  ) {
    await this.assertCanManageStudent(context, assessment, entry.studentId);
    if (!entry.isAbsent && entry.marksObtained === undefined) {
      throw new BadRequestException('Enter marks or mark the student absent');
    }
    if (entry.marksObtained !== undefined && entry.marksObtained > Number(assessment.maxMarks)) {
      throw new BadRequestException(`Marks cannot exceed ${assessment.maxMarks}`);
    }
    const exam = await this.database.examination.findUniqueOrThrow({
      where: { id: assessment.examinationId },
    });
    const enrollment = await this.database.enrollment.findFirst({
      where: {
        studentId: entry.studentId,
        academicYearId: exam.academicYearId,
        classId: assessment.classId,
        status: { in: ['ACTIVE', 'PROMOTED'] },
      },
    });
    if (!enrollment) throw new BadRequestException('Student is not enrolled in this class');
    const existing = await this.database.mark.findUnique({
      where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: entry.studentId } },
    });
    if (existing?.status === 'SUBMITTED' && !context.isLeader) {
      throw new ConflictException('Submitted marks need a correction request');
    }
    const data = {
      marksObtained: entry.isAbsent ? null : entry.marksObtained,
      isAbsent: entry.isAbsent ?? false,
      remarks: entry.remarks?.trim() || null,
      enteredById: context.userId,
    };
    const mark = await this.database.mark.upsert({
      where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: entry.studentId } },
      create: {
        ...data,
        schoolId: context.schoolId,
        assessmentId: assessment.id,
        studentId: entry.studentId,
        enrollmentId: enrollment.id,
      },
      update: data,
    });
    if (existing) {
      await this.audit.record(context, {
        action: 'marks.updated',
        entityType: 'mark',
        entityId: mark.id,
        oldValue: { marksObtained: existing.marksObtained, isAbsent: existing.isAbsent },
        newValue: { marksObtained: data.marksObtained, isAbsent: data.isAbsent },
      });
    }
    return mark;
  }

  private async editableAssessment(context: SchoolContext, assessmentId: string) {
    const assessment = await this.database.assessment.findFirst({
      where: { id: assessmentId, schoolId: context.schoolId },
      include: { examination: true },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');
    if (assessment.examination.status !== 'DRAFT') {
      throw new ConflictException(
        `Marks are ${assessment.examination.status.toLowerCase()}; use a correction request`,
      );
    }
    if (!context.isLeader) {
      const studentIds = await this.manageableStudentIds(context, assessment);
      if (studentIds !== true && !studentIds.length) {
        throw new ForbiddenException('You are not assigned to this class and subject');
      }
    }
    return assessment;
  }

  /** Students whose marks the caller may enter for this assessment; `true` means all. */
  private async manageableStudentIds(context: SchoolContext, assessment: Assessment): Promise<string[] | true> {
    if (context.isLeader) return true;
    if (!context.staffId) return [];
    const exam = await this.database.examination.findUniqueOrThrow({ where: { id: assessment.examinationId } });
    const assignments = await this.database.staffAssignment.findMany({
      where: {
        staffId: context.staffId,
        classId: assessment.classId,
        subjectId: assessment.subjectId,
        academicYearId: exam.academicYearId,
      },
    });
    if (!assignments.length) return [];
    const wholeClass = assignments.some((assignment) => !assignment.sectionId);
    const enrollments = await this.database.enrollment.findMany({
      where: {
        classId: assessment.classId,
        academicYearId: exam.academicYearId,
        ...(wholeClass
          ? {}
          : { sectionId: { in: assignments.map((assignment) => assignment.sectionId as string) } }),
      },
      select: { studentId: true },
    });
    return enrollments.map((enrollment) => enrollment.studentId);
  }

  private async assertCanManageStudent(context: SchoolContext, assessment: Assessment, studentId: string) {
    const allowed = await this.manageableStudentIds(context, assessment);
    if (allowed !== true && !allowed.includes(studentId)) {
      throw new ForbiddenException('You cannot enter marks for this student');
    }
  }

  private async teacherMarkScope(context: SchoolContext): Promise<Prisma.MarkWhereInput[]> {
    if (!context.staffId) return [{ id: '00000000-0000-0000-0000-000000000000' }];
    const assignments = await this.database.staffAssignment.findMany({
      where: { staffId: context.staffId },
    });
    if (!assignments.length) return [{ id: '00000000-0000-0000-0000-000000000000' }];
    return assignments.map((assignment) => ({
      assessment: { classId: assignment.classId, subjectId: assignment.subjectId },
      ...(assignment.sectionId ? { enrollment: { sectionId: assignment.sectionId } } : {}),
    }));
  }

  private async verificationData(context: SchoolContext, exam: Examination) {
    const assessments = await this.database.assessment.findMany({
      where: { examinationId: exam.id },
      include: {
        class: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        marks: { select: { status: true } },
      },
    });
    let missing = 0;
    let unsubmitted = 0;
    const rows = [];
    for (const assessment of assessments) {
      const enrolled = await this.database.enrollment.count({
        where: {
          schoolId: context.schoolId,
          academicYearId: exam.academicYearId,
          classId: assessment.classId,
          status: { in: ['ACTIVE', 'PROMOTED'] },
        },
      });
      const entered = assessment.marks.length;
      const submitted = assessment.marks.filter((mark) => mark.status === 'SUBMITTED').length;
      missing += Math.max(enrolled - entered, 0);
      unsubmitted += entered - submitted;
      rows.push({
        assessmentId: assessment.id,
        class: assessment.class,
        subject: assessment.subject,
        enrolled,
        entered,
        submitted,
        complete: enrolled === submitted,
      });
    }
    return { examinationId: exam.id, status: exam.status, missing, unsubmitted, assessments: rows };
  }

  private async notifyRelease(context: SchoolContext, exam: Examination) {
    const students = await this.database.mark.findMany({
      where: { assessment: { examinationId: exam.id } },
      distinct: ['studentId'],
      select: { studentId: true },
    });
    for (const { studentId } of students) {
      await this.notify.toStudentFamily(studentId, {
        type: 'exam.released',
        title: 'Results released',
        body: `${exam.name} results are now available.`,
        data: { examinationId: exam.id, studentId },
      });
    }
  }

  private async leader(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    return context;
  }

  private async scopedExam(context: SchoolContext, examinationId: string) {
    const exam = await this.database.examination.findFirst({
      where: { id: examinationId, schoolId: context.schoolId },
    });
    if (!exam) throw new NotFoundException('Examination not found');
    return exam;
  }
}
