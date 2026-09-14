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
import { CreateAttendanceDto } from './dto/create-attendance.dto';
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

  @Get()
  @RequirePermissions('attendance:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('attendanceDate') attendanceDate?: string,
    @Query('enrollmentId') enrollmentId?: string,
  ) {
    return this.attendance.findMany(user, { attendanceDate, enrollmentId });
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
}
