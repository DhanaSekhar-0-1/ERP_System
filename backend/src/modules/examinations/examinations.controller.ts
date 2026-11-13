import { SchoolModule } from '../../common/school-modules/school-modules';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import {
  AddClassSubjectsDto,
  BulkMarksDto,
  CreateAssessmentDto,
  CreateExaminationDto,
  CreateMarkDto,
  CreateSlipTestDto,
  ExamNoteDto,
  MarkCorrectionDto,
  MarksQueryDto,
  RereleaseRequestDto,
  SubmitMarksDto,
  UpdateExaminationDto,
  UpdateMarkDto,
} from './dto/examinations.dto';
import { ExaminationsService } from './examinations.service';

@SchoolModule('exams')
@Controller('examinations')
export class ExaminationsController {
  constructor(private readonly exams: ExaminationsService) {}

  @Get()
  @RequirePermissions('examinations:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
  ) {
    return this.exams.findMany(user, academicYearId);
  }

  @Post()
  @RequirePermissions('examinations:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateExaminationDto) {
    return this.exams.create(user, input);
  }

  /** Teachers create slip tests for their own classes and subjects. */
  @Post('slip-tests')
  @RequirePermissions('marks:manage')
  createSlipTest(@CurrentUser() user: SupabaseUser, @Body() input: CreateSlipTestDto) {
    return this.exams.createSlipTest(user, input);
  }

  @Get(':examinationId')
  @RequirePermissions('examinations:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
  ) {
    return this.exams.findOne(user, examinationId);
  }

  @Patch(':examinationId')
  @RequirePermissions('examinations:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: UpdateExaminationDto,
  ) {
    return this.exams.update(user, examinationId, input);
  }

  @Post(':examinationId/assessments')
  @RequirePermissions('examinations:manage')
  addAssessment(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: CreateAssessmentDto,
  ) {
    return this.exams.addAssessment(user, examinationId, input);
  }

  @Post(':examinationId/assessments/class')
  @RequirePermissions('examinations:manage')
  addClassSubjects(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: AddClassSubjectsDto,
  ) {
    return this.exams.addClassSubjects(user, examinationId, input);
  }

  /** Marks progress and approval status of each section the exam covers. */
  @Get(':examinationId/sections')
  @RequirePermissions('marks:verify')
  sections(@CurrentUser() user: SupabaseUser, @Param('examinationId', ParseUUIDPipe) examinationId: string) {
    return this.exams.sectionProgress(user, examinationId);
  }

  /** School Admin approves every section whose marks are complete. */
  @Post(':examinationId/sections/verify-ready')
  @RequirePermissions('marks:verify')
  verifyReadySections(@CurrentUser() user: SupabaseUser, @Param('examinationId', ParseUUIDPipe) examinationId: string) {
    return this.exams.bulkSectionAction(user, examinationId, 'verify');
  }

  /** Principal releases every approved section. */
  @Post(':examinationId/sections/release-approved')
  @RequirePermissions('examinations:release')
  releaseApprovedSections(@CurrentUser() user: SupabaseUser, @Param('examinationId', ParseUUIDPipe) examinationId: string) {
    return this.exams.bulkSectionAction(user, examinationId, 'release');
  }

  @Post(':examinationId/sections/:sectionId/verify')
  @RequirePermissions('marks:verify')
  verifySection(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.sectionAction(user, examinationId, sectionId, 'verify', input.note);
  }

  @Post(':examinationId/sections/:sectionId/release')
  @RequirePermissions('examinations:release')
  releaseSection(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.sectionAction(user, examinationId, sectionId, 'release', input.note);
  }

  @Post(':examinationId/sections/:sectionId/reject')
  @RequirePermissions('marks:verify')
  rejectSection(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.sectionAction(user, examinationId, sectionId, 'reject', input.note);
  }

  @Get(':examinationId/verification')
  @RequirePermissions('marks:verify')
  verification(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
  ) {
    return this.exams.verification(user, examinationId);
  }

  @Post(':examinationId/verify')
  @RequirePermissions('marks:verify')
  verify(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.transition(user, examinationId, 'verify', input.note);
  }

  @Post(':examinationId/reject')
  @RequirePermissions('marks:verify')
  reject(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.transition(user, examinationId, 'reject', input.note);
  }

  @Post(':examinationId/lock')
  @RequirePermissions('examinations:manage')
  lock(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.transition(user, examinationId, 'lock', input.note);
  }

  @Post(':examinationId/unlock')
  @RequirePermissions('examinations:manage')
  unlock(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.transition(user, examinationId, 'unlock', input.note);
  }

  @Post(':examinationId/release')
  @RequirePermissions('examinations:release')
  release(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: ExamNoteDto,
  ) {
    return this.exams.transition(user, examinationId, 'release', input.note);
  }

  @Post(':examinationId/rerelease-request')
  @RequirePermissions('examinations:manage')
  rerelease(
    @CurrentUser() user: SupabaseUser,
    @Param('examinationId', ParseUUIDPipe) examinationId: string,
    @Body() input: RereleaseRequestDto,
  ) {
    return this.exams.rereleaseRequest(user, examinationId, input);
  }
}

@SchoolModule('exams')
@Controller('marks')
export class MarksController {
  constructor(private readonly exams: ExaminationsService) {}

  @Get()
  @RequirePermissions('marks:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: MarksQueryDto) {
    return this.exams.findMarks(user, query);
  }

  /** Exam subjects the signed-in teacher can enter marks for. */
  @Get('my-assessments')
  @RequirePermissions('marks:manage')
  myAssessments(@CurrentUser() user: SupabaseUser) {
    return this.exams.myAssessments(user);
  }

  /** The students of an exam subject that the caller can see, with any marks entered. */
  @Get('sheet/:assessmentId')
  @RequirePermissions('marks:read')
  sheet(
    @CurrentUser() user: SupabaseUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    return this.exams.markSheet(user, assessmentId);
  }

  @Post()
  @RequirePermissions('marks:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateMarkDto) {
    return this.exams.createMark(user, input);
  }

  @Post('bulk')
  @RequirePermissions('marks:manage')
  bulk(@CurrentUser() user: SupabaseUser, @Body() input: BulkMarksDto) {
    return this.exams.bulkMarks(user, input);
  }

  @Post('submit')
  @RequirePermissions('marks:manage')
  submit(@CurrentUser() user: SupabaseUser, @Body() input: SubmitMarksDto) {
    return this.exams.submitMarks(user, input.assessmentId);
  }

  @Get(':markId')
  @RequirePermissions('marks:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('markId', ParseUUIDPipe) markId: string,
  ) {
    return this.exams.findMark(user, markId);
  }

  @Patch(':markId')
  @RequirePermissions('marks:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('markId', ParseUUIDPipe) markId: string,
    @Body() input: UpdateMarkDto,
  ) {
    return this.exams.updateMark(user, markId, input);
  }

  @Post(':markId/correction-request')
  @RequirePermissions('marks:manage')
  correction(
    @CurrentUser() user: SupabaseUser,
    @Param('markId', ParseUUIDPipe) markId: string,
    @Body() input: MarkCorrectionDto,
  ) {
    return this.exams.requestCorrection(user, markId, input);
  }
}

@SchoolModule('exams')
@Controller('students/:studentId/report-cards')
export class ReportCardsController {
  constructor(private readonly exams: ExaminationsService) {}

  @Get()
  @RequirePermissions('marks:read')
  reportCards(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.exams.reportCards(user, studentId);
  }
}
