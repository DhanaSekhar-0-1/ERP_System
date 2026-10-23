import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { StaffAssignmentsService } from '../staff-assignments/staff-assignments.service';
import {
  ReassignStaffAssignmentDto,
  StaffAssignmentInputDto,
} from '../staff-assignments/dto/create-staff-assignment.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly assignments: StaffAssignmentsService,
  ) {}

  @Post()
  @RequirePermissions('users:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateStaffDto) {
    return this.staff.create(user, input);
  }

  @Get()
  @RequirePermissions('staff:read')
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.staff.findMany(user);
  }

  @Get(':staffId')
  @RequirePermissions('staff:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.staff.findOne(user, staffId);
  }

  @Patch(':staffId')
  @RequirePermissions('users:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() input: UpdateStaffDto,
  ) {
    return this.staff.update(user, staffId, input);
  }

  @Post(':staffId/activate')
  @RequirePermissions('users:manage')
  activate(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.staff.setActive(user, staffId, true);
  }

  @Post(':staffId/deactivate')
  @RequirePermissions('users:manage')
  deactivate(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.staff.setActive(user, staffId, false);
  }

  @Get(':staffId/assignments')
  @RequirePermissions('staff-assignments:read')
  assignmentsFor(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.assignments.findMany(user, { staffId });
  }

  @Post(':staffId/assignments')
  @RequirePermissions('staff-assignments:manage')
  assign(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() input: StaffAssignmentInputDto,
  ) {
    return this.assignments.create(user, { ...input, staffId });
  }

  @Patch(':staffId/assignments/:assignmentId')
  @RequirePermissions('staff-assignments:manage')
  reassign(
    @CurrentUser() user: SupabaseUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() input: ReassignStaffAssignmentDto,
  ) {
    return this.assignments.reassign(user, assignmentId, input);
  }

  @Delete(':staffId/assignments/:assignmentId')
  @RequirePermissions('staff-assignments:manage')
  unassign(
    @CurrentUser() user: SupabaseUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.assignments.remove(user, assignmentId);
  }
}
