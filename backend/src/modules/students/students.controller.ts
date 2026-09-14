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
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsDto } from './dto/list-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentsService } from './students.service';

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
}
