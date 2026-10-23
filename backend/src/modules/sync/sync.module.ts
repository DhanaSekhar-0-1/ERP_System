import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExaminationsModule } from '../examinations/examinations.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AttendanceModule, ExaminationsModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
