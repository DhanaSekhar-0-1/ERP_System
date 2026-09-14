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
import { HomeworkService } from './homework.service';

@Controller('homework')
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get()
  @RequirePermissions('homework:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('classId') classId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.homework.findMany(user, {
      academicYearId,
      classId,
      sectionId,
      subjectId,
      teacherId,
    });
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

  @Post(':homeworkId/submit')
  @RequirePermissions('homework:read')
  submit(
    @CurrentUser() user: SupabaseUser,
    @Param('homeworkId', ParseUUIDPipe) homeworkId: string,
    @Body() input: SubmitHomeworkDto,
  ) {
    return this.homework.submit(user, homeworkId, input);
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
