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
  BulkMarksDto,
  CreateAssessmentDto,
  CreateExaminationDto,
  CreateMarkDto,
  ExamNoteDto,
  MarkCorrectionDto,
  MarksQueryDto,
  RereleaseRequestDto,
  SubmitMarksDto,
  UpdateExaminationDto,
  UpdateMarkDto,
} from './dto/examinations.dto';
import { ExaminationsService } from './examinations.service';

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

@Controller('marks')
export class MarksController {
  constructor(private readonly exams: ExaminationsService) {}

  @Get()
  @RequirePermissions('marks:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: MarksQueryDto) {
    return this.exams.findMarks(user, query);
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
