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
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsDto } from './dto/list-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentsService } from './students.service';

class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Post()
  @RequirePermissions('students:manage')
  create(
    @CurrentUser() user: SupabaseUser,
    @Body() input: CreateStudentDto,
  ) {
    return this.students.create(user, input);
  }

  @Get()
  @RequirePermissions('students:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query() input: ListStudentsDto,
  ) {
    return this.students.findMany(user, input);
  }

  @Get(':studentId')
  @RequirePermissions('students:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.students.findOne(user, studentId);
  }

  @Patch(':studentId')
  @RequirePermissions('students:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() input: UpdateStudentDto,
  ) {
    return this.students.update(user, studentId, input);
  }

  @Post(':studentId/archive')
  @RequirePermissions('students:manage')
  archive(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() input: ReasonDto,
  ) {
    return this.students.archive(user, studentId, input.reason);
  }

  @Post(':studentId/restore')
  @RequirePermissions('students:manage')
  restore(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() input: ReasonDto,
  ) {
    return this.students.restore(user, studentId, input.reason);
  }

  @Get(':studentId/history')
  @RequirePermissions('students:read')
  history(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.students.history(user, studentId);
  }

  @Get(':studentId/documents')
  @RequirePermissions('students:read')
  documents(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.students.documents(user, studentId);
  }
}
