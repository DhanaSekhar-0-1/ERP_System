import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import {
  LocationDto,
  StaffAttendanceCorrectionDto,
  StaffAttendanceQueryDto,
  StaffAttendanceSettingsDto,
} from './staff-attendance.dto';
import { StaffAttendanceService } from './staff-attendance.service';

/** Teacher check-in and check-out, the school's day view, corrections and settings. */
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly attendance: StaffAttendanceService) {}

  @Get('me/today')
  @RequirePermissions('staff-attendance:check-in')
  today(@CurrentUser() user: SupabaseUser) {
    return this.attendance.today(user);
  }

  @Post('check-in')
  @RequirePermissions('staff-attendance:check-in')
  checkIn(@CurrentUser() user: SupabaseUser, @Body() input: LocationDto) {
    return this.attendance.checkIn(user, input);
  }

  @Post('check-out')
  @RequirePermissions('staff-attendance:check-in')
  checkOut(@CurrentUser() user: SupabaseUser, @Body() input: LocationDto) {
    return this.attendance.checkOut(user, input);
  }

  @Get('settings')
  @RequirePermissions('staff-attendance:read')
  settings(@CurrentUser() user: SupabaseUser) {
    return this.attendance.getSettings(user);
  }

  @Put('settings')
  @RequirePermissions('staff-attendance:manage')
  updateSettings(@CurrentUser() user: SupabaseUser, @Body() input: StaffAttendanceSettingsDto) {
    return this.attendance.updateSettings(user, input);
  }

  @Get()
  @RequirePermissions('staff-attendance:read')
  day(@CurrentUser() user: SupabaseUser, @Query() query: StaffAttendanceQueryDto) {
    return this.attendance.day(user, query);
  }

  @Put(':staffId')
  @RequirePermissions('staff-attendance:manage')
  correct(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() input: StaffAttendanceCorrectionDto,
  ) {
    return this.attendance.correct(user, staffId, input);
  }
}
