import { Module } from '@nestjs/common';
import { StaffAssignmentsModule } from '../staff-assignments/staff-assignments.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [StaffAssignmentsModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
