import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateStaffAssignmentDto } from './dto/create-staff-assignment.dto';
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
    @Query('staffId') staffId?: string,
    @Query('classId') classId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.assignments.findMany(user, { staffId, classId, academicYearId });
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
