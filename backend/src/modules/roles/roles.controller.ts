import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles:read')
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.roles.findMany(user);
  }

  @Post()
  @RequirePermissions('roles:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateRoleDto) {
    return this.roles.create(user, input);
  }

  @Get(':roleId')
  @RequirePermissions('roles:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.roles.findOne(user, roleId);
  }

  @Patch(':roleId')
  @RequirePermissions('roles:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() input: UpdateRoleDto,
  ) {
    return this.roles.update(user, roleId, input);
  }

  @Get(':roleId/permissions')
  @RequirePermissions('permissions:read')
  getPermissions(
    @CurrentUser() user: SupabaseUser,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.roles.getPermissions(user, roleId);
  }

  @Put(':roleId/permissions')
  @RequirePermissions('roles:manage')
  updatePermissions(
    @CurrentUser() user: SupabaseUser,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() input: UpdateRolePermissionsDto,
  ) {
    return this.roles.updatePermissions(user, roleId, input);
  }
}
