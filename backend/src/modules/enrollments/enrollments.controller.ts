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
import {
  PromoteEnrollmentDto,
  StudentEnrollmentDto,
  TransferEnrollmentDto,
  WithdrawEnrollmentDto,
} from './dto/enrollment-actions.dto';
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
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
    @Query('classId', new ParseUUIDPipe({ optional: true })) classId?: string,
    @Query('sectionId', new ParseUUIDPipe({ optional: true })) sectionId?: string,
    @Query('studentId', new ParseUUIDPipe({ optional: true })) studentId?: string,
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

  @Post(':enrollmentId/transfer')
  @RequirePermissions('enrollments:read')
  transfer(
    @CurrentUser() user: SupabaseUser,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() input: TransferEnrollmentDto,
  ) {
    return this.enrollments.transfer(user, enrollmentId, input);
  }

  @Post(':enrollmentId/promote')
  @RequirePermissions('enrollments:manage')
  promote(
    @CurrentUser() user: SupabaseUser,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() input: PromoteEnrollmentDto,
  ) {
    return this.enrollments.promote(user, enrollmentId, input);
  }

  @Post(':enrollmentId/withdraw')
  @RequirePermissions('enrollments:manage')
  withdraw(
    @CurrentUser() user: SupabaseUser,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Body() input: WithdrawEnrollmentDto,
  ) {
    return this.enrollments.withdraw(user, enrollmentId, input);
  }
}

@Controller('students/:studentId/enrollments')
export class StudentEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequirePermissions('enrollments:read')
  findForStudent(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.enrollments.forStudent(user, studentId);
  }

  @Post()
  @RequirePermissions('enrollments:manage')
  create(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() input: StudentEnrollmentDto,
  ) {
    return this.enrollments.create(user, { ...input, studentId });
  }
}
