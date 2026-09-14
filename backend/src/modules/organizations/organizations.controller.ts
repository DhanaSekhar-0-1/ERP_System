import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateSchoolDto } from '../schools/dto/create-school.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequirePermissions('organizations:read')
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.organizations.findMany(user);
  }

  @Post()
  @RequirePermissions('organizations:manage')
  create(
    @CurrentUser() user: SupabaseUser,
    @Body() input: CreateOrganizationDto,
  ) {
    return this.organizations.create(user, input);
  }

  @Get(':organizationId')
  @RequirePermissions('organizations:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizations.findOne(user, organizationId);
  }

  @Patch(':organizationId')
  @RequirePermissions('organizations:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() input: UpdateOrganizationDto,
  ) {
    return this.organizations.update(user, organizationId, input);
  }

  @Get(':organizationId/schools')
  @RequirePermissions('schools:read')
  findSchools(
    @CurrentUser() user: SupabaseUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.organizations.findSchools(user, organizationId);
  }

  @Post(':organizationId/schools')
  @RequirePermissions('schools:manage')
  createSchool(
    @CurrentUser() user: SupabaseUser,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() input: CreateSchoolDto,
  ) {
    return this.organizations.createSchool(user, organizationId, input);
  }
}
