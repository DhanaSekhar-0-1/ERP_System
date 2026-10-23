import {
  Body,
  Controller,
  Delete,
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
import { CreateHomeworkDto } from './dto/create-homework.dto';
import { SubmitHomeworkDto } from './dto/submit-homework.dto';
import { UpdateHomeworkDto } from './dto/update-homework.dto';
import {
  GradeSubmissionDto,
  HomeworkQueryDto,
  ReturnSubmissionDto,
} from './dto/grade-submission.dto';
import { HomeworkService } from './homework.service';

@Controller('homework')
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get()
  @RequirePermissions('homework:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: HomeworkQueryDto) {
    return this.homework.findMany(user, query);
  }

  @Post()
  @RequirePermissions('homework:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateHomeworkDto) {
    return this.homework.create(user, input);
  }

  @Get(':homeworkId')
  @RequirePermissions('homework:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
  ) {
    return this.homework.findOne(user, homeworkId);
  }

  @Patch(':homeworkId')
  @RequirePermissions('homework:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
    @Body() input: UpdateHomeworkDto,
  ) {
    return this.homework.update(user, homeworkId, input);
  }

  @Delete(':homeworkId')
  @RequirePermissions('homework:manage')
  remove(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
  ) {
    return this.homework.remove(user, homeworkId);
  }

  @Post(':homeworkId/publish')
  @RequirePermissions('homework:manage')
  publish(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
  ) {
    return this.homework.publish(user, homeworkId);
  }

  @Post(':homeworkId/archive')
  @RequirePermissions('homework:manage')
  archive(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
  ) {
    return this.homework.archive(user, homeworkId);
  }

  @Post(':homeworkId/submit')
  @RequirePermissions('homework:read')
  submit(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
    @Body() input: SubmitHomeworkDto,
  ) {
    return this.homework.submit(user, homeworkId, input);
  }

  @Get(':homeworkId/submissions')
  @RequirePermissions('homework:manage')
  submissions(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
  ) {
    return this.homework.submissions(user, homeworkId);
  }

  @Post(':homeworkId/submissions/:submissionId/grade')
  @RequirePermissions('homework:manage')
  grade(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() input: GradeSubmissionDto,
  ) {
    return this.homework.grade(user, homeworkId, submissionId, input);
  }

  @Post(':homeworkId/submissions/:submissionId/return')
  @RequirePermissions('homework:manage')
  returnSubmission(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() input: ReturnSubmissionDto,
  ) {
    return this.homework.returnSubmission(user, homeworkId, submissionId, input);
  }
}

@Controller('students')
export class StudentHomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get(':studentId/homework')
  @RequirePermissions('homework:read')
  findForStudent(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.homework.findForStudent(user, studentId);
  }
}
