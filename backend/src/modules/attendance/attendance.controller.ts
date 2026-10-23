import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { RawResponse } from '../../common/http/response.interceptor';
import {
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
  BulkAttendanceDto,
  CorrectionRequestDto,
  CreateAttendanceDto,
} from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post()
  @RequirePermissions('attendance:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateAttendanceDto) {
    return this.attendance.create(user, input);
  }

  @Post('bulk')
  @RequirePermissions('attendance:manage')
  bulk(@CurrentUser() user: SupabaseUser, @Body() input: BulkAttendanceDto) {
    return this.attendance.bulk(user, input);
  }

  @Get()
  @RequirePermissions('attendance:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: AttendanceQueryDto) {
    return this.attendance.findMany(user, query);
  }

  @Get('summary')
  @RequirePermissions('attendance:read')
  summary(@CurrentUser() user: SupabaseUser, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendance.summary(user, query);
  }

  @Get('export')
  @RequirePermissions('attendance:read', 'reports:read')
  @RawResponse()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="attendance.csv"')
  export(@CurrentUser() user: SupabaseUser, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendance.exportCsv(user, query);
  }

  @Get(':attendanceId')
  @RequirePermissions('attendance:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
  ) {
    return this.attendance.findOne(user, attendanceId);
  }

  @Patch(':attendanceId')
  @RequirePermissions('attendance:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Body() input: UpdateAttendanceDto,
  ) {
    return this.attendance.update(user, attendanceId, input);
  }

  @Post(':attendanceId/correction-request')
  @RequirePermissions('attendance:manage')
  correction(
    @CurrentUser() user: SupabaseUser,
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Body() input: CorrectionRequestDto,
  ) {
    return this.attendance.requestCorrection(user, attendanceId, input);
  }
}

@Controller()
export class AttendanceViewsController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('students/:studentId/attendance')
  @RequirePermissions('attendance:read')
  forStudent(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendance.forStudent(user, studentId, query);
  }

  @Get('sections/:sectionId/attendance')
  @RequirePermissions('attendance:read')
  forSection(
    @CurrentUser() user: SupabaseUser,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendance.forSection(user, sectionId, query);
  }
}
