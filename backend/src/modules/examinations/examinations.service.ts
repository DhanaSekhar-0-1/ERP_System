import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Assessment, ExamStatus, ExamType, Examination, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { NotifyService } from '../../common/notify/notify.service';
import {
  AddClassSubjectsDto,
  BulkMarksDto,
  CreateAssessmentDto,
  CreateExaminationDto,
  CreateMarkDto,
  CreateSlipTestDto,
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

/** Default names for the built-in exam types. */
export const EXAM_TYPE_NAMES: Record<ExamType, string | null> = {
  FA1: 'FA1',
  FA2: 'FA2',
  FA3: 'FA3',
  FA4: 'FA4',
  Q1: 'Q1 Quarterly',
  Q2: 'Q2 Half-yearly',
  Q3: 'Q3 Annual',
  PRE_PUBLIC: 'Pre-public',
  SLIP_TEST: null,
  OTHER: null,
};

const NO_MATCH = '00000000-0000-0000-0000-000000000000';

/**
 * Marks move DRAFT -> VERIFIED -> RELEASED. The School Admin verifies (first approval) and the
 * Principal releases (final approval). Locking in between is optional. A slip test needs only
 * the School Admin, whose approval releases it straight away.
 */
const NEXT_STATUS: Record<string, { from: ExamStatus[]; to: ExamStatus }> = {
  verify: { from: ['DRAFT'], to: 'VERIFIED' },
  lock: { from: ['VERIFIED'], to: 'LOCKED' },
  release: { from: ['VERIFIED', 'LOCKED'], to: 'RELEASED' },
  unlock: { from: ['LOCKED'], to: 'DRAFT' },
  reject: { from: ['VERIFIED'], to: 'DRAFT' },
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
          data: { status: 'DRAFT', releasedAt: null },
        });
        await transaction.examSection.deleteMany({ where: { examinationId: request.entityId } });
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
    const type = input.type ?? 'OTHER';
    const name = input.name?.trim() || EXAM_TYPE_NAMES[type];
    if (!name) throw new BadRequestException('Give the examination a name');
    const exam = await this.uniqueExamName(() =>
      this.database.examination.create({
        data: {
          schoolId: context.schoolId,
          academicYearId: input.academicYearId,
          type,
          name,
          term: input.term?.trim() || null,
          startsOn: input.startsOn ? new Date(input.startsOn) : null,
          endsOn: input.endsOn ? new Date(input.endsOn) : null,
          createdById: context.userId,
        },
      }),
    );
    await this.audit.record(context, {
      action: 'examination.created',
      entityType: 'examination',
      entityId: exam.id,
      newValue: input,
    });
    return exam;
  }

  /** A teacher's slip test for one of their own classes and subjects, with its single assessment. */
  async createSlipTest(authUser: SupabaseUser, input: CreateSlipTestDto) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && !context.isTeacher) {
      throw new ForbiddenException('Only teachers and school leaders can create slip tests');
    }
    const year = await this.database.academicYear.findFirst({
      where: input.academicYearId
        ? { id: input.academicYearId, schoolId: context.schoolId }
        : { schoolId: context.schoolId, isActive: true },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    if (year.isClosed) throw new BadRequestException('This academic year is closed');
    const [schoolClass, subject, section] = await Promise.all([
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId: context.schoolId, academicYearId: year.id },
      }),
      this.database.subject.findFirst({
        where: { id: input.subjectId, schoolId: context.schoolId, academicYearId: year.id },
      }),
      input.sectionId
        ? this.database.section.findFirst({ where: { id: input.sectionId, classId: input.classId } })
        : Promise.resolve(null),
    ]);
    if (!schoolClass || !subject) throw new NotFoundException('Class or subject not found in this year');
    if (input.sectionId && !section) throw new NotFoundException('Section not found in this class');
    if (input.passMarks !== undefined && input.passMarks > input.maxMarks) {
      throw new BadRequestException('Pass marks cannot exceed maximum marks');
    }
    if (!context.isLeader) {
      const assignments = await this.database.staffAssignment.findMany({
        where: {
          staffId: context.staffId ?? NO_MATCH,
          academicYearId: year.id,
          classId: input.classId,
          subjectId: input.subjectId,
        },
      });
      const wholeClass = assignments.some((assignment) => !assignment.sectionId);
      const covered =
        wholeClass ||
        (Boolean(input.sectionId) &&
          assignments.some((assignment) => assignment.sectionId === input.sectionId));
      if (!covered) {
        throw new ForbiddenException(
          assignments.length
            ? 'Choose one of your sections for this slip test'
            : 'You are not assigned to this class and subject',
        );
      }
    }
    const exam = await this.uniqueExamName(() =>
      this.database.examination.create({
        data: {
          schoolId: context.schoolId,
          academicYearId: year.id,
          type: 'SLIP_TEST',
          name: input.name.trim(),
          startsOn: input.examDate ? new Date(input.examDate) : null,
          createdById: context.userId,
          assessments: {
            create: {
              schoolId: context.schoolId,
              classId: input.classId,
              sectionId: input.sectionId ?? null,
              subjectId: input.subjectId,
              maxMarks: input.maxMarks,
              passMarks: input.passMarks ?? null,
              examDate: input.examDate ? new Date(input.examDate) : null,
            },
          },
        },
        include: { assessments: { include: { class: true, section: true, subject: true } } },
      }),
    );
    await this.audit.record(context, {
      action: 'examination.created',
      entityType: 'examination',
      entityId: exam.id,
      newValue: { ...input, type: 'SLIP_TEST' },
    });
    return exam;
  }

  async findMany(authUser: SupabaseUser, academicYearId?: string) {
    const context = await this.access.schoolContext(authUser);
    const family = !context.isLeader && !context.isTeacher;
    return this.database.examination.findMany({
      where: {
        schoolId: context.schoolId,
        ...(academicYearId ? { academicYearId } : {}),
        ...(family ? await this.releasedForFamily(context) : {}),
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
        ...(!context.isLeader && !context.isTeacher ? await this.releasedForFamily(context) : {}),
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
    if (exam.type === 'PRE_PUBLIC' && !this.isClassTen(schoolClass)) {
      throw new BadRequestException('Pre-public exams are only for Class 10');
    }
    if (input.passMarks !== undefined && input.passMarks > input.maxMarks) {
      throw new BadRequestException('Pass marks cannot exceed maximum marks');
    }
    // A section's own subject is examined in that section only.
    let sectionId: string | null = null;
    if (subject.sectionId) {
      const section = await this.database.section.findFirst({ where: { id: subject.sectionId, classId: input.classId } });
      if (!section) throw new BadRequestException('This subject belongs to a section of another class');
      if (!subject.isEnabled) throw new BadRequestException('This subject is switched off for its section');
      sectionId = section.id;
    }
    const approved = await this.database.examSection.findFirst({
      where: {
        examinationId,
        status: { not: 'DRAFT' },
        section: sectionId ? { id: sectionId } : { classId: input.classId },
      },
      include: { section: { select: { name: true } } },
    });
    if (approved) {
      throw new ConflictException(`Section ${approved.section.name} of this class is already approved; subjects cannot be added to it`);
    }
    return this.database.assessment.create({
      data: {
        schoolId: context.schoolId,
        examinationId,
        classId: input.classId,
        sectionId,
        subjectId: input.subjectId,
        maxMarks: input.maxMarks,
        passMarks: input.passMarks ?? null,
        examDate: input.examDate ? new Date(input.examDate) : null,
      },
      include: { class: true, subject: true },
    });
  }

  /** Adds every switched-on subject of each section in the class, skipping ones already added. */
  async addClassSubjects(authUser: SupabaseUser, examinationId: string, input: AddClassSubjectsDto) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    if (exam.status !== 'DRAFT') {
      throw new ConflictException('Subjects can be added only to draft examinations');
    }
    if (exam.type === 'SLIP_TEST') {
      throw new BadRequestException('Slip tests cover one subject');
    }
    const classIds = [...new Set([...(input.classIds ?? []), ...(input.classId ? [input.classId] : [])])];
    if (!classIds.length) throw new BadRequestException('Choose at least one class');
    if (input.passMarks !== undefined && input.passMarks > input.maxMarks) {
      throw new BadRequestException('Pass marks cannot exceed maximum marks');
    }
    const classes = await this.database.schoolClass.findMany({
      where: { id: { in: classIds }, schoolId: context.schoolId, academicYearId: exam.academicYearId },
      include: {
        sections: {
          where: { isArchived: false },
          include: { subjects: { where: { isEnabled: true } } },
        },
      },
    });
    if (classes.length !== classIds.length) {
      throw new NotFoundException('One or more classes were not found in the examination year');
    }
    if (exam.type === 'PRE_PUBLIC') {
      const notTen = classes.filter((schoolClass) => !this.isClassTen(schoolClass));
      if (notTen.length) {
        throw new BadRequestException(`Pre-public exams are only for Class 10, not ${notTen.map((c) => c.name).join(', ')}`);
      }
    }
    // Sections already approved or released keep the subjects they were approved with.
    const locked = new Set(
      (
        await this.database.examSection.findMany({
          where: { examinationId, status: { not: 'DRAFT' } },
          select: { sectionId: true },
        })
      ).map((row) => row.sectionId),
    );
    const rows = classes.flatMap((schoolClass) =>
      schoolClass.sections.filter((section) => !locked.has(section.id)).flatMap((section) =>
        section.subjects.map((subject) => ({
          schoolId: context.schoolId,
          examinationId,
          classId: schoolClass.id,
          sectionId: section.id,
          subjectId: subject.id,
          maxMarks: input.maxMarks,
          passMarks: input.passMarks ?? null,
          examDate: input.examDate ? new Date(input.examDate) : null,
        })),
      ),
    );
    if (!rows.length) {
      throw new BadRequestException(classes.length === 1 ? 'This class has no subjects switched on' : 'These classes have no subjects switched on');
    }
    const created = await this.database.assessment.createMany({ data: rows, skipDuplicates: true });
    return { added: created.count, skipped: rows.length - created.count, classes: classes.length };
  }

  /** Draft exam subjects in the teacher's own classes, sections and subjects. */
  async myAssessments(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!context.staffId) return [];
    const assignments = await this.database.staffAssignment.findMany({
      where: { staffId: context.staffId, academicYear: { isActive: true } },
      include: { subject: { select: { code: true, sectionId: true } } },
    });
    if (!assignments.length) return [];
    const assessments = await this.database.assessment.findMany({
      where: {
        schoolId: context.schoolId,
        examination: { academicYear: { isActive: true } },
        OR: assignments.map((assignment) => ({
          AND: [
            { classId: assignment.classId },
            this.subjectMatch(assignment),
            assignment.sectionId ? { OR: [{ sectionId: assignment.sectionId }, { sectionId: null }] } : {},
          ],
        })),
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        examination: { select: { id: true, name: true, type: true, status: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        marks: { select: { status: true, studentId: true } },
      },
    });
    const approvals = await this.database.examSection.findMany({
      where: { examinationId: { in: [...new Set(assessments.map((item) => item.examinationId))] } },
      select: { examinationId: true, sectionId: true, status: true },
    });
    const approvalOf = (examinationId: string, sectionId: string | null | undefined) =>
      sectionId ? approvals.find((row) => row.examinationId === examinationId && row.sectionId === sectionId)?.status : undefined;
    const result = [];
    for (const assessment of assessments) {
      const students = await this.manageableStudentIds(context, assessment);
      const ids = students === true ? null : new Set(students);
      const mine = assessment.marks.filter((mark) => !ids || ids.has(mark.studentId));
      result.push({
        id: assessment.id,
        examination: assessment.examination,
        class: assessment.class,
        section: assessment.section,
        subject: assessment.subject,
        maxMarks: Number(assessment.maxMarks),
        passMarks: assessment.passMarks === null ? null : Number(assessment.passMarks),
        students: ids ? ids.size : null,
        entered: mine.length,
        submitted: mine.filter((mark) => mark.status === 'SUBMITTED').length,
        // DRAFT: waiting for marks; VERIFIED: admin approved; RELEASED: visible to families.
        status:
          assessment.examination.status === 'DRAFT'
            ? approvalOf(assessment.examinationId, assessment.sectionId ?? assignments.find((a) => a.classId === assessment.classId)?.sectionId) ?? 'DRAFT'
            : assessment.examination.status === 'LOCKED'
              ? 'VERIFIED'
              : assessment.examination.status,
      });
    }
    return result;
  }

  /** Students the caller may enter marks for in one exam subject, with their current marks. */
  async markSheet(authUser: SupabaseUser, assessmentId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && !context.isTeacher) {
      throw new ForbiddenException('Only teachers and school leaders can open a mark sheet');
    }
    const assessment = await this.database.assessment.findFirst({
      where: { id: assessmentId, schoolId: context.schoolId },
      include: {
        examination: { select: { id: true, name: true, type: true, status: true, academicYearId: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
      },
    });
    if (!assessment) throw new NotFoundException('Exam subject not found');
    const allowed = await this.manageableStudentIds(context, assessment);
    if (allowed !== true && !allowed.length) {
      throw new ForbiddenException('You are not assigned to this class and subject');
    }
    const enrollments = await this.database.enrollment.findMany({
      where: {
        classId: assessment.classId,
        academicYearId: assessment.examination.academicYearId,
        status: { in: ['ACTIVE', 'PROMOTED'] },
        ...(assessment.sectionId ? { sectionId: assessment.sectionId } : {}),
        ...(allowed === true ? {} : { studentId: { in: allowed } }),
      },
      orderBy: [{ section: { name: 'asc' } }, { rollNumber: 'asc' }],
      select: {
        rollNumber: true,
        section: { select: { name: true } },
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      },
    });
    const marks = await this.database.mark.findMany({
      where: { assessmentId, studentId: { in: enrollments.map((row) => row.student.id) } },
    });
    const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
    return {
      assessment: {
        id: assessment.id,
        examination: assessment.examination,
        class: assessment.class,
        section: assessment.section,
        subject: assessment.subject,
        maxMarks: Number(assessment.maxMarks),
        passMarks: assessment.passMarks === null ? null : Number(assessment.passMarks),
      },
      students: enrollments.map((row) => {
        const mark = byStudent.get(row.student.id);
        return {
          student: row.student,
          section: row.section.name,
          rollNumber: row.rollNumber,
          mark: mark
            ? {
                id: mark.id,
                marksObtained: mark.marksObtained === null ? null : Number(mark.marksObtained),
                isAbsent: mark.isAbsent,
                status: mark.status,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Progress and approval of every section an exam covers. A section is complete when every
   * student in it has a submitted mark for each of the exam's subjects in that section.
   */
  async sectionProgress(authUser: SupabaseUser, examinationId: string) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    return { examinationId: exam.id, type: exam.type, status: exam.status, sections: await this.sectionRows(exam) };
  }

  /** Approve, release or send back one section of an exam. */
  async sectionAction(authUser: SupabaseUser, examinationId: string, sectionId: string, action: 'verify' | 'release' | 'reject', note?: string) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    const rows = await this.sectionRows(exam);
    const row = rows.find((item) => item.section.id === sectionId);
    if (!row) throw new NotFoundException('This exam does not cover that section');
    return this.applySectionAction(context, exam, row, action, note);
  }

  /** The School Admin approves every complete section, or the Principal releases every approved one. */
  async bulkSectionAction(authUser: SupabaseUser, examinationId: string, action: 'verify' | 'release') {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    this.assertSectionRole(context, exam, action);
    const rows = await this.sectionRows(exam);
    const ready = rows.filter((row) => (action === 'verify' ? row.status === 'DRAFT' && row.complete : row.status === 'VERIFIED'));
    const done = [];
    for (const row of ready) {
      await this.applySectionAction(context, exam, row, action);
      done.push({ sectionId: row.section.id, name: `${row.class.name}-${row.section.name}` });
    }
    const waiting = rows
      .filter((row) => !ready.includes(row) && row.status !== 'RELEASED' && (action === 'release' || row.status === 'DRAFT'))
      .map((row) => ({ sectionId: row.section.id, name: `${row.class.name}-${row.section.name}`, status: row.status, missing: row.missing }));
    return { [action === 'verify' ? 'approved' : 'released']: done, waiting };
  }

  private assertSectionRole(context: SchoolContext, exam: Examination, action: 'verify' | 'release' | 'reject') {
    const isAdmin = context.isSchoolAdmin || context.isSuperAdmin;
    const slipTest = exam.type === 'SLIP_TEST';
    if (action === 'verify' && !isAdmin) throw new ForbiddenException('The School Admin approves marks first');
    if (action === 'release' && slipTest && !isAdmin) {
      throw new ForbiddenException('The School Admin approves and releases slip tests');
    }
    if (action === 'release' && !slipTest && !context.isPrincipal && !context.isSuperAdmin) {
      throw new ForbiddenException('Only the Principal gives final approval and releases results');
    }
    if (exam.status !== 'DRAFT') {
      throw new ConflictException(`This exam is already ${exam.status.toLowerCase()} as a whole`);
    }
  }

  private async applySectionAction(
    context: SchoolContext,
    exam: Examination,
    row: Awaited<ReturnType<ExaminationsService['sectionRows']>>[number],
    action: 'verify' | 'release' | 'reject',
    note?: string,
  ) {
    this.assertSectionRole(context, exam, action);
    const label = `${row.class.name}-${row.section.name}`;
    if (action === 'verify') {
      if (row.status !== 'DRAFT') throw new ConflictException(`${label} is already ${row.status.toLowerCase()}`);
      if (!row.subjects) throw new ConflictException(`${label} has no subjects in this exam`);
      if (!row.complete) {
        throw new ConflictException(`Cannot approve ${label} yet: ${row.missing} marks missing or not submitted`);
      }
    }
    if (action === 'release' && row.status !== 'VERIFIED') {
      throw new ConflictException(`${label} must be approved by the School Admin first`);
    }
    if (action === 'reject' && row.status !== 'VERIFIED') {
      throw new ConflictException(`Only an approved section can be sent back`);
    }
    // A slip test needs only the School Admin, whose approval releases it.
    const releases = action === 'release' || (action === 'verify' && exam.type === 'SLIP_TEST');
    const status: ExamStatus = releases ? 'RELEASED' : action === 'verify' ? 'VERIFIED' : 'DRAFT';
    const now = new Date();
    const key = { examinationId_sectionId: { examinationId: exam.id, sectionId: row.section.id } };
    const fields =
      action === 'reject'
        ? { status, verifiedAt: null, verifiedById: null }
        : {
            status,
            ...(action === 'verify' ? { verifiedAt: now, verifiedById: context.userId } : {}),
            ...(releases ? { releasedAt: now, releasedById: context.userId } : {}),
          };
    const sectionMarks: Prisma.MarkWhereInput = {
      assessment: { examinationId: exam.id },
      enrollment: { sectionId: row.section.id },
    };
    const examReleased = await this.database.$transaction(async (transaction) => {
      await transaction.examSection.upsert({
        where: key,
        create: { schoolId: exam.schoolId, examinationId: exam.id, sectionId: row.section.id, ...fields },
        update: fields,
      });
      if (action === 'reject') {
        await transaction.mark.updateMany({ where: sectionMarks, data: { status: 'DRAFT' } });
      }
      if (releases) {
        await transaction.mark.updateMany({ where: { ...sectionMarks, releasedAt: null }, data: { releasedAt: now } });
      }
      await this.audit.record(
        context,
        {
          action: `examination.section-${releases ? 'release' : action}`,
          entityType: 'examination',
          entityId: exam.id,
          oldValue: { sectionId: row.section.id, status: row.status },
          newValue: { sectionId: row.section.id, status },
          reason: note,
        },
        transaction,
      );
      if (!releases) return false;
      // When every section is released, the exam as a whole is released.
      const sections = await this.examSectionIds(exam.id, transaction);
      const released = await transaction.examSection.count({
        where: { examinationId: exam.id, status: 'RELEASED', sectionId: { in: sections } },
      });
      if (released < sections.length) return false;
      await transaction.examination.update({
        where: { id: exam.id },
        data: { status: 'RELEASED', releasedAt: now, releasedById: context.userId },
      });
      return true;
    });
    if (releases) await this.notifyRelease(context, exam, row.section.id);
    return {
      sectionId: row.section.id,
      name: label,
      status,
      examReleased,
    };
  }

  /** Sections an exam covers: each section subject's section, and every section of a class-wide subject. */
  private async examSectionIds(examinationId: string, client: Prisma.TransactionClient | DatabaseService = this.database) {
    const assessments = await client.assessment.findMany({
      where: { examinationId },
      select: { classId: true, sectionId: true },
    });
    const ids = new Set(assessments.filter((a) => a.sectionId).map((a) => a.sectionId as string));
    const wholeClasses = [...new Set(assessments.filter((a) => !a.sectionId).map((a) => a.classId))];
    if (wholeClasses.length) {
      const sections = await client.section.findMany({
        where: { classId: { in: wholeClasses }, isArchived: false },
        select: { id: true },
      });
      sections.forEach((section) => ids.add(section.id));
    }
    return [...ids];
  }

  private async sectionRows(exam: Examination) {
    const assessments = await this.database.assessment.findMany({
      where: { examinationId: exam.id },
      select: { id: true, classId: true, sectionId: true },
    });
    const sectionIds = await this.examSectionIds(exam.id);
    const [sections, approvals, enrollments, marks] = await Promise.all([
      this.database.section.findMany({
        where: { id: { in: sectionIds } },
        select: { id: true, name: true, classId: true, class: { select: { id: true, name: true, sortOrder: true } } },
      }),
      this.database.examSection.findMany({ where: { examinationId: exam.id } }),
      this.database.enrollment.groupBy({
        by: ['sectionId'],
        where: { sectionId: { in: sectionIds }, academicYearId: exam.academicYearId, status: { in: ['ACTIVE', 'PROMOTED'] } },
        _count: { _all: true },
      }),
      this.database.mark.findMany({
        where: { assessment: { examinationId: exam.id } },
        select: { assessmentId: true, status: true, enrollment: { select: { sectionId: true } } },
      }),
    ]);
    return sections
      .sort((a, b) => a.class.sortOrder - b.class.sortOrder || a.class.name.localeCompare(b.class.name) || a.name.localeCompare(b.name))
      .map((section) => {
        const subjects = assessments.filter(
          (item) => item.sectionId === section.id || (!item.sectionId && item.classId === section.classId),
        );
        const subjectIds = new Set(subjects.map((item) => item.id));
        const students = enrollments.find((row) => row.sectionId === section.id)?._count._all ?? 0;
        const own = marks.filter((mark) => mark.enrollment.sectionId === section.id && subjectIds.has(mark.assessmentId));
        const expected = students * subjects.length;
        const submitted = own.filter((mark) => mark.status === 'SUBMITTED').length;
        const approval = approvals.find((row) => row.sectionId === section.id);
        const status: ExamStatus =
          exam.status === 'RELEASED' ? 'RELEASED' : approval?.status === 'LOCKED' ? 'VERIFIED' : approval?.status ?? 'DRAFT';
        return {
          section: { id: section.id, name: section.name },
          class: { id: section.class.id, name: section.class.name },
          subjects: subjects.length,
          students,
          expected,
          entered: own.length,
          submitted,
          missing: Math.max(expected - submitted, 0),
          complete: subjects.length > 0 && submitted >= expected,
          status,
          verifiedAt: approval?.verifiedAt ?? null,
          releasedAt: approval?.releasedAt ?? null,
        };
      });
  }

  /** Exams a student or parent can see: ones with at least one released mark of theirs. */
  private async releasedForFamily(context: SchoolContext): Promise<Prisma.ExaminationWhereInput> {
    const scope = await this.access.studentScope(context);
    const ids = scope.all ? [] : scope.ids;
    return { assessments: { some: { marks: { some: { studentId: { in: ids }, releasedAt: { not: null } } } } } };
  }

  async transition(authUser: SupabaseUser, examinationId: string, action: string, note?: string) {
    const context = await this.leader(authUser);
    const exam = await this.scopedExam(context, examinationId);
    const step = NEXT_STATUS[action];
    const isAdmin = context.isSchoolAdmin || context.isSuperAdmin;
    const slipTest = exam.type === 'SLIP_TEST';
    if (action === 'verify' && !isAdmin) {
      throw new ForbiddenException('The School Admin approves marks first');
    }
    if (action === 'release') {
      if (slipTest && !isAdmin) {
        throw new ForbiddenException('The School Admin approves and releases slip tests');
      }
      if (!slipTest && !context.isPrincipal && !context.isSuperAdmin) {
        throw new ForbiddenException('Only the Principal gives final approval and releases results');
      }
    }
    if (!step.from.includes(exam.status)) {
      throw new ConflictException(
        `Cannot ${action} an examination that is ${exam.status.toLowerCase()}`,
      );
    }
    if (action === 'verify') {
      const verification = await this.verificationData(context, exam);
      if (!verification.assessments.length) {
        throw new ConflictException('Add at least one subject before approving marks');
      }
      if (verification.missing > 0 || verification.unsubmitted > 0) {
        throw new ConflictException(
          `Cannot approve yet: ${verification.missing} marks missing and ${verification.unsubmitted} not submitted by teachers`,
        );
      }
    }
    // The School Admin's approval is the only one a slip test needs, so it also releases it.
    const releases = action === 'release' || (action === 'verify' && slipTest);
    const to: ExamStatus = releases ? 'RELEASED' : step.to;
    const now = new Date();
    const data: Prisma.ExaminationUpdateInput = { status: to };
    if (action === 'verify') Object.assign(data, { verifiedAt: now, verifiedById: context.userId });
    if (action === 'lock') Object.assign(data, { lockedAt: now });
    if (releases) Object.assign(data, { releasedAt: now, releasedById: context.userId });
    const updated = await this.database.$transaction(async (transaction) => {
      const result = await transaction.examination.update({ where: { id: exam.id }, data });
      if (action === 'reject' || action === 'unlock') {
        await transaction.mark.updateMany({
          where: { assessment: { examinationId: exam.id } },
          data: { status: 'DRAFT' },
        });
        await transaction.examSection.updateMany({
          where: { examinationId: exam.id, status: { not: 'RELEASED' } },
          data: { status: 'DRAFT', verifiedAt: null, verifiedById: null },
        });
      }
      if (releases) {
        await transaction.mark.updateMany({
          where: { assessment: { examinationId: exam.id }, releasedAt: null },
          data: { releasedAt: now },
        });
        const sections = await this.examSectionIds(exam.id, transaction);
        for (const sectionId of sections) {
          await transaction.examSection.upsert({
            where: { examinationId_sectionId: { examinationId: exam.id, sectionId } },
            create: { schoolId: exam.schoolId, examinationId: exam.id, sectionId, status: 'RELEASED', releasedAt: now, releasedById: context.userId },
            update: { status: 'RELEASED', releasedAt: now, releasedById: context.userId },
          });
        }
      }
      await this.audit.record(
        context,
        {
          action: `examination.${action}`,
          entityType: 'examination',
          entityId: exam.id,
          oldValue: { status: exam.status },
          newValue: { status: to },
          reason: note,
        },
        transaction,
      );
      return result;
    });
    if (releases) {
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
          releasedAt: { not: null },
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
    const released = Boolean(mark.releasedAt) || mark.assessment.examination.status === 'RELEASED';
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
        releasedAt: { not: null },
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
        ...(assessment.sectionId ? { sectionId: assessment.sectionId } : {}),
        status: { in: ['ACTIVE', 'PROMOTED'] },
      },
    });
    if (!enrollment) {
      throw new BadRequestException(
        assessment.sectionId ? 'Student is not in this section' : 'Student is not enrolled in this class',
      );
    }
    const sectionApproval = await this.database.examSection.findUnique({
      where: { examinationId_sectionId: { examinationId: exam.id, sectionId: enrollment.sectionId } },
    });
    if (sectionApproval && sectionApproval.status !== 'DRAFT') {
      throw new ConflictException('Marks for this section are already approved; use a correction request');
    }
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
    const [exam, subject] = await Promise.all([
      this.database.examination.findUniqueOrThrow({ where: { id: assessment.examinationId } }),
      this.database.subject.findUniqueOrThrow({ where: { id: assessment.subjectId }, select: { code: true } }),
    ]);
    // The teacher's own assignment for this subject, or an older school-wide subject with the same code.
    const assignments = await this.database.staffAssignment.findMany({
      where: {
        staffId: context.staffId,
        classId: assessment.classId,
        academicYearId: exam.academicYearId,
        OR: [{ subjectId: assessment.subjectId }, { subject: { sectionId: null, code: subject.code } }],
      },
    });
    if (!assignments.length) return [];
    const wholeClass = assignments.some((assignment) => !assignment.sectionId);
    const sections = assignments.map((assignment) => assignment.sectionId as string);
    if (assessment.sectionId && !wholeClass && !sections.includes(assessment.sectionId)) return [];
    const sectionFilter = assessment.sectionId
      ? { sectionId: assessment.sectionId }
      : wholeClass
        ? {}
        : { sectionId: { in: sections } };
    const enrollments = await this.database.enrollment.findMany({
      where: {
        classId: assessment.classId,
        academicYearId: exam.academicYearId,
        ...sectionFilter,
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
      include: { subject: { select: { code: true, sectionId: true } } },
    });
    if (!assignments.length) return [{ id: '00000000-0000-0000-0000-000000000000' }];
    return assignments.map((assignment) => ({
      assessment: { AND: [{ classId: assignment.classId }, this.subjectMatch(assignment)] },
      ...(assignment.sectionId ? { enrollment: { sectionId: assignment.sectionId } } : {}),
    }));
  }

  /**
   * Exam subjects an assignment covers. Section subjects match exactly. An older school-wide subject
   * (no section) also covers the section subjects with the same code, so teachers assigned before
   * subjects became per-section still see and mark their exams.
   */
  private subjectMatch(assignment: { subjectId: string; subject: { code: string; sectionId: string | null } }): Prisma.AssessmentWhereInput {
    if (assignment.subject.sectionId) return { subjectId: assignment.subjectId };
    return { OR: [{ subjectId: assignment.subjectId }, { subject: { code: assignment.subject.code, sectionId: { not: null } } }] };
  }

  private async verificationData(context: SchoolContext, exam: Examination) {
    const assessments = await this.database.assessment.findMany({
      where: { examinationId: exam.id },
      include: {
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
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
          ...(assessment.sectionId ? { sectionId: assessment.sectionId } : {}),
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
        section: assessment.section,
        subject: assessment.subject,
        enrolled,
        entered,
        submitted,
        complete: enrolled === submitted,
      });
    }
    return { examinationId: exam.id, status: exam.status, missing, unsubmitted, assessments: rows };
  }

  private async notifyRelease(context: SchoolContext, exam: Examination, sectionId?: string) {
    const students = await this.database.mark.findMany({
      where: { assessment: { examinationId: exam.id }, ...(sectionId ? { enrollment: { sectionId } } : {}) },
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

  /** Class 10 is recognised by its order or its name, such as "Class 10" or "X". */
  private isClassTen(schoolClass: { name: string; sortOrder: number | null }) {
    return schoolClass.sortOrder === 10 || /\b(10|x)\b/i.test(schoolClass.name);
  }

  /** Runs a create and turns a duplicate exam name into a clear 409. */
  private async uniqueExamName<T>(create: () => Promise<T>): Promise<T> {
    try {
      return await create();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An examination with this name already exists in this academic year');
      }
      throw error;
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
