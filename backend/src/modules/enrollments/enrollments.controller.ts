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
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Post()
  @RequirePermissions('enrollments:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateEnrollmentDto) {
    return this.enrollments.create(user, input);
  }

  @Get()
  @RequirePermissions('enrollments:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId') academicYearId?: string,
    @Query('classId') classId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.enrollments.findMany(user, {
      academicYearId,
      classId,
      sectionId,
      studentId,
    });
  }

  @Get(':enrollmentId')
  @RequirePermissions('enrollments:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
  ) {
    return this.enrollments.findOne(user, enrollmentId);
  }

  @Patch(':enrollmentId')
  @RequirePermissions('enrollments:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() input: UpdateEnrollmentDto,
  ) {
    return this.enrollments.update(user, enrollmentId, input);
  }
}
