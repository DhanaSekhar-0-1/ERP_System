import {
  Body,
  Controller,
  Delete,
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
  CreateStaffAssignmentDto,
  ReassignStaffAssignmentDto,
} from './dto/create-staff-assignment.dto';
import { StaffAssignmentsService } from './staff-assignments.service';

@Controller('staff-assignments')
export class StaffAssignmentsController {
  constructor(private readonly assignments: StaffAssignmentsService) {}

  @Post()
  @RequirePermissions('staff-assignments:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateStaffAssignmentDto) {
    return this.assignments.create(user, input);
  }

  @Get()
  @RequirePermissions('staff-assignments:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('staffId', new ParseUUIDPipe({ optional: true })) staffId?: string,
    @Query('classId', new ParseUUIDPipe({ optional: true })) classId?: string,
    @Query('sectionId', new ParseUUIDPipe({ optional: true })) sectionId?: string,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
  ) {
    return this.assignments.findMany(user, { staffId, classId, sectionId, academicYearId });
  }

  @Patch(':assignmentId')
  @RequirePermissions('staff-assignments:manage')
  reassign(
    @CurrentUser() user: SupabaseUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() input: ReassignStaffAssignmentDto,
  ) {
    return this.assignments.reassign(user, assignmentId, input);
  }

  @Delete(':assignmentId')
  @RequirePermissions('staff-assignments:manage')
  remove(
    @CurrentUser() user: SupabaseUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.assignments.remove(user, assignmentId);
  }
}
