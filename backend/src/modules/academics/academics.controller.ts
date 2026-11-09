import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AcademicsService } from './academics.service';
import {
  CreateSectionSubjectDto,
  DefaultSubjectsDto,
  SetTeacherDto,
  UpdateSectionSubjectDto,
} from './dto/academics.dto';

/** Class, section, subject and teacher-assignment management. */
@Controller('academics')
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('classes')
  @RequirePermissions('classes:read')
  overview(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId', ParseUUIDPipe) academicYearId: string,
  ) {
    return this.academics.overview(user, academicYearId);
  }

  @Get('classes/:classId')
  @RequirePermissions('classes:read')
  classDetail(@CurrentUser() user: SupabaseUser, @Param('classId', ParseUUIDPipe) classId: string) {
    return this.academics.classDetail(user, classId);
  }

  @Delete('classes/:classId')
  @RequirePermissions('classes:manage')
  deleteClass(@CurrentUser() user: SupabaseUser, @Param('classId', ParseUUIDPipe) classId: string) {
    return this.academics.deleteClass(user, classId);
  }

  @Delete('sections/:sectionId')
  @RequirePermissions('sections:manage')
  deleteSection(@CurrentUser() user: SupabaseUser, @Param('sectionId', ParseUUIDPipe) sectionId: string) {
    return this.academics.deleteSection(user, sectionId);
  }

  @Get('sections/:sectionId/students')
  @RequirePermissions('students:read')
  sectionStudents(@CurrentUser() user: SupabaseUser, @Param('sectionId', ParseUUIDPipe) sectionId: string) {
    return this.academics.sectionStudents(user, sectionId);
  }

  @Get('sections/:sectionId/subjects')
  @RequirePermissions('subjects:read')
  sectionSubjects(@CurrentUser() user: SupabaseUser, @Param('sectionId', ParseUUIDPipe) sectionId: string) {
    return this.academics.sectionSubjects(user, sectionId);
  }

  @Post('sections/:sectionId/subjects')
  @RequirePermissions('subjects:manage')
  addSubject(
    @CurrentUser() user: SupabaseUser,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() input: CreateSectionSubjectDto,
  ) {
    return this.academics.addSubject(user, sectionId, input);
  }

  @Patch('subjects/:subjectId')
  @RequirePermissions('subjects:manage')
  updateSubject(
    @CurrentUser() user: SupabaseUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() input: UpdateSectionSubjectDto,
  ) {
    return this.academics.updateSubject(user, subjectId, input);
  }

  @Delete('subjects/:subjectId')
  @RequirePermissions('subjects:manage')
  deleteSubject(@CurrentUser() user: SupabaseUser, @Param('subjectId', ParseUUIDPipe) subjectId: string) {
    return this.academics.deleteSubject(user, subjectId);
  }

  @Put('subjects/:subjectId/teacher')
  @RequirePermissions('staff-assignments:manage')
  setSubjectTeacher(
    @CurrentUser() user: SupabaseUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() input: SetTeacherDto,
  ) {
    return this.academics.setSubjectTeacher(user, subjectId, input.staffId);
  }

  @Put('sections/:sectionId/class-teacher')
  @RequirePermissions('staff-assignments:manage')
  setClassTeacher(
    @CurrentUser() user: SupabaseUser,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() input: SetTeacherDto,
  ) {
    return this.academics.setClassTeacher(user, sectionId, input.staffId);
  }

  @Get('assignments')
  @RequirePermissions('staff-assignments:read')
  assignments(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId', ParseUUIDPipe) academicYearId: string,
  ) {
    return this.academics.assignments(user, academicYearId);
  }

  @Get('default-subjects')
  @RequirePermissions('subjects:read')
  getDefaultSubjects(@CurrentUser() user: SupabaseUser) {
    return this.academics.getDefaultSubjects(user);
  }

  @Put('default-subjects')
  @RequirePermissions('subjects:manage')
  setDefaultSubjects(@CurrentUser() user: SupabaseUser, @Body() input: DefaultSubjectsDto) {
    return this.academics.setDefaultSubjects(user, input);
  }

  /** The signed-in teacher's own subjects and class-teacher sections. */
  @Get('my-teaching')
  @RequirePermissions('staff-assignments:read')
  myTeaching(@CurrentUser() user: SupabaseUser) {
    return this.academics.myTeaching(user);
  }
}
