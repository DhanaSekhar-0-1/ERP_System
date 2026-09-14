import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { UpdateSchoolSettingsDto } from './dto/update-school-settings.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SchoolsService } from './schools.service';

@Controller('schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get(':schoolId')
  @RequirePermissions('schools:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
  ) {
    return this.schools.findOne(user, schoolId);
  }

  @Patch(':schoolId')
  @RequirePermissions('schools:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Body() input: UpdateSchoolDto,
  ) {
    return this.schools.update(user, schoolId, input);
  }

  @Get(':schoolId/settings')
  @RequirePermissions('schools:read')
  getSettings(
    @CurrentUser() user: SupabaseUser,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
  ) {
    return this.schools.getSettings(user, schoolId);
  }

  @Patch(':schoolId/settings')
  @RequirePermissions('schools:manage')
  updateSettings(
    @CurrentUser() user: SupabaseUser,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Body() input: UpdateSchoolSettingsDto,
  ) {
    return this.schools.updateSettings(user, schoolId, input);
  }

  @Post(':schoolId/archive')
  @RequirePermissions('schools:manage')
  archive(
    @CurrentUser() user: SupabaseUser,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
  ) {
    return this.schools.archive(user, schoolId);
  }

  @Post(':schoolId/restore')
  @RequirePermissions('schools:manage')
  restore(
    @CurrentUser() user: SupabaseUser,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
  ) {
    return this.schools.restore(user, schoolId);
  }
}
