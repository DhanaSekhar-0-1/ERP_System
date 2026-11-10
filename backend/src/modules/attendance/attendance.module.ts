import { Module } from '@nestjs/common';
import { AttendanceController, AttendanceDashboardController, AttendanceViewsController } from './attendance.controller';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { AttendanceService } from './attendance.service';

@Module({
  controllers: [AttendanceController, AttendanceViewsController, AttendanceDashboardController],
  providers: [AttendanceService, AttendanceDashboardService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
