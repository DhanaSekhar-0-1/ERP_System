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
  AssignComplaintDto,
  ComplaintNoteDto,
  ComplaintQueryDto,
  CreateComplaintDto,
  CreateFeedbackDto,
  UpdateComplaintDto,
  UpdateFeedbackDto,
} from './dto/complaints.dto';
import { ComplaintsService } from './complaints.service';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @RequirePermissions('feedback:submit')
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.complaints.findFeedback(user);
  }

  @Post()
  @RequirePermissions('feedback:submit')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateFeedbackDto) {
    return this.complaints.createFeedback(user, input);
  }

  @Get(':feedbackId')
  @RequirePermissions('feedback:submit')
  findOne(@CurrentUser() user: SupabaseUser, @Param('feedbackId', ParseUUIDPipe) id: string) {
    return this.complaints.findFeedbackOne(user, id);
  }

  @Patch(':feedbackId')
  @RequirePermissions('feedback:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('feedbackId', ParseUUIDPipe) id: string,
    @Body() input: UpdateFeedbackDto,
  ) {
    return this.complaints.updateFeedback(user, id, input);
  }
}

@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @RequirePermissions('complaints:submit')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: ComplaintQueryDto) {
    return this.complaints.findMany(user, query);
  }

  @Post()
  @RequirePermissions('complaints:submit')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateComplaintDto) {
    return this.complaints.create(user, input);
  }

  @Get(':complaintId')
  @RequirePermissions('complaints:submit')
  findOne(@CurrentUser() user: SupabaseUser, @Param('complaintId', ParseUUIDPipe) id: string) {
    return this.complaints.findOne(user, id);
  }

  @Patch(':complaintId')
  @RequirePermissions('complaints:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('complaintId', ParseUUIDPipe) id: string,
    @Body() input: UpdateComplaintDto,
  ) {
    return this.complaints.update(user, id, input);
  }

  @Post(':complaintId/assign')
  @RequirePermissions('complaints:manage')
  assign(
    @CurrentUser() user: SupabaseUser,
    @Param('complaintId', ParseUUIDPipe) id: string,
    @Body() input: AssignComplaintDto,
  ) {
    return this.complaints.assign(user, id, input);
  }

  @Post(':complaintId/start-investigation')
  @RequirePermissions('complaints:manage')
  investigate(@CurrentUser() user: SupabaseUser, @Param('complaintId', ParseUUIDPipe) id: string) {
    return this.complaints.startInvestigation(user, id);
  }

  @Post(':complaintId/add-action')
  @RequirePermissions('complaints:manage')
  addAction(
    @CurrentUser() user: SupabaseUser,
    @Param('complaintId', ParseUUIDPipe) id: string,
    @Body() input: ComplaintNoteDto,
  ) {
    return this.complaints.addAction(user, id, input.note);
  }

  @Post(':complaintId/resolve')
  @RequirePermissions('complaints:manage')
  resolve(
    @CurrentUser() user: SupabaseUser,
    @Param('complaintId', ParseUUIDPipe) id: string,
    @Body() input: ComplaintNoteDto,
  ) {
    return this.complaints.resolve(user, id, input.note);
  }

  @Post(':complaintId/reopen')
  @RequirePermissions('complaints:submit')
  reopen(
    @CurrentUser() user: SupabaseUser,
    @Param('complaintId', ParseUUIDPipe) id: string,
    @Body() input: ComplaintNoteDto,
  ) {
    return this.complaints.reopen(user, id, input.note);
  }

  @Post(':complaintId/escalate')
  @RequirePermissions('complaints:manage')
  escalate(
    @CurrentUser() user: SupabaseUser,
    @Param('complaintId', ParseUUIDPipe) id: string,
    @Body() input: ComplaintNoteDto,
  ) {
    return this.complaints.escalate(user, id, input.note);
  }

  @Get(':complaintId/history')
  @RequirePermissions('complaints:submit')
  history(@CurrentUser() user: SupabaseUser, @Param('complaintId', ParseUUIDPipe) id: string) {
    return this.complaints.history(user, id);
  }
}
