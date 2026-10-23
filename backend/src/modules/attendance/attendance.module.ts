import { Module } from '@nestjs/common';
import { AttendanceController, AttendanceViewsController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  controllers: [AttendanceController, AttendanceViewsController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
