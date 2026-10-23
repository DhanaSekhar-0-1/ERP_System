import { Module } from '@nestjs/common';
import {
  StaffLeaveBalanceController,
  StaffLeavesController,
  StudentLeavesController,
} from './leaves.controller';
import { LeavesService } from './leaves.service';

@Module({
  controllers: [StudentLeavesController, StaffLeavesController, StaffLeaveBalanceController],
  providers: [LeavesService],
})
export class LeavesModule {}
