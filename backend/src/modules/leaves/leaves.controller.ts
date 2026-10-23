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
import {
  CreateStaffLeaveDto,
  CreateStudentLeaveDto,
  LeaveDecisionDto,
  LeaveQueryDto,
  UpdateEntitlementsDto,
  UpdateLeaveDto,
} from './dto/leaves.dto';
import { LeavesService } from './leaves.service';

@Controller('student-leaves')
export class StudentLeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Get()
  @RequirePermissions('leaves:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: LeaveQueryDto) {
    return this.leaves.findStudentLeaves(user, query);
  }

  @Post()
  @RequirePermissions('leaves:request')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateStudentLeaveDto) {
    return this.leaves.createStudentLeave(user, input);
  }

  @Get(':leaveId')
  @RequirePermissions('leaves:read')
  findOne(@CurrentUser() user: SupabaseUser, @Param('leaveId', ParseUUIDPipe) leaveId: string) {
    return this.leaves.findStudentLeave(user, leaveId);
  }

  @Patch(':leaveId')
  @RequirePermissions('leaves:request')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('leaveId', ParseUUIDPipe) leaveId: string,
    @Body() input: UpdateLeaveDto,
  ) {
    return this.leaves.updateStudentLeave(user, leaveId, input);
  }

  @Post(':leaveId/approve')
  @RequirePermissions('leaves:manage')
  approve(
    @CurrentUser() user: SupabaseUser,
    @Param('leaveId', ParseUUIDPipe) leaveId: string,
    @Body() input: LeaveDecisionDto,
  ) {
    return this.leaves.decideStudentLeave(user, leaveId, 'APPROVED', input.note);
  }

  @Post(':leaveId/reject')
  @RequirePermissions('leaves:manage')
  reject(
    @CurrentUser() user: SupabaseUser,
    @Param('leaveId', ParseUUIDPipe) leaveId: string,
    @Body() input: LeaveDecisionDto,
  ) {
    return this.leaves.decideStudentLeave(user, leaveId, 'REJECTED', input.note);
  }

  @Post(':leaveId/cancel')
  @RequirePermissions('leaves:request')
  cancel(@CurrentUser() user: SupabaseUser, @Param('leaveId', ParseUUIDPipe) leaveId: string) {
    return this.leaves.cancelStudentLeave(user, leaveId);
  }
}

@Controller('staff-leaves')
export class StaffLeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Get()
  @RequirePermissions('staff-leaves:request')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: LeaveQueryDto) {
    return this.leaves.findStaffLeaves(user, query);
  }

  @Post()
  @RequirePermissions('staff-leaves:request')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateStaffLeaveDto) {
    return this.leaves.createStaffLeave(user, input);
  }

  @Get(':leaveId')
  @RequirePermissions('staff-leaves:request')
  findOne(@CurrentUser() user: SupabaseUser, @Param('leaveId', ParseUUIDPipe) leaveId: string) {
    return this.leaves.findStaffLeave(user, leaveId);
  }

  @Post(':leaveId/approve')
  @RequirePermissions('staff-leaves:manage')
  approve(
    @CurrentUser() user: SupabaseUser,
    @Param('leaveId', ParseUUIDPipe) leaveId: string,
    @Body() input: LeaveDecisionDto,
  ) {
    return this.leaves.decideStaffLeave(user, leaveId, 'APPROVED', input.note);
  }

  @Post(':leaveId/reject')
  @RequirePermissions('staff-leaves:manage')
  reject(
    @CurrentUser() user: SupabaseUser,
    @Param('leaveId', ParseUUIDPipe) leaveId: string,
    @Body() input: LeaveDecisionDto,
  ) {
    return this.leaves.decideStaffLeave(user, leaveId, 'REJECTED', input.note);
  }

  @Post(':leaveId/cancel')
  @RequirePermissions('staff-leaves:request')
  cancel(@CurrentUser() user: SupabaseUser, @Param('leaveId', ParseUUIDPipe) leaveId: string) {
    return this.leaves.cancelStaffLeave(user, leaveId);
  }
}

@Controller('staff/:staffId')
export class StaffLeaveBalanceController {
  constructor(private readonly leaves: LeavesService) {}

  @Get('leave-balance')
  @RequirePermissions('staff-leaves:request')
  balance(@CurrentUser() user: SupabaseUser, @Param('staffId', ParseUUIDPipe) staffId: string) {
    return this.leaves.leaveBalance(user, staffId);
  }

  @Patch('leave-entitlements')
  @RequirePermissions('staff-leaves:manage')
  entitlements(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() input: UpdateEntitlementsDto,
  ) {
    return this.leaves.updateEntitlements(user, staffId, input);
  }
}
