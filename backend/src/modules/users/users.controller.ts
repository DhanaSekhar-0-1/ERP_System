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
import { AssignUserRoleDto } from './dto/assign-user-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreatePermissionOverrideDto } from './dto/permission-override.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.users.findMany(user);
  }

  @Post()
  @RequirePermissions('users:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateUserDto) {
    return this.users.create(user, input);
  }

  @Get(':userId')
  @RequirePermissions('users:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.findOne(user, userId);
  }

  @Patch(':userId')
  @RequirePermissions('users:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: UpdateUserDto,
  ) {
    return this.users.update(user, userId, input);
  }

  @Post(':userId/activate')
  @RequirePermissions('users:manage')
  activate(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.activate(user, userId);
  }

  @Post(':userId/deactivate')
  @RequirePermissions('users:manage')
  deactivate(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.deactivate(user, userId);
  }

  @Post(':userId/invite')
  @RequirePermissions('users:manage')
  invite(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.invite(user, userId);
  }

  @Post(':userId/resend-invite')
  @RequirePermissions('users:manage')
  resendInvite(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.resendInvite(user, userId);
  }

  @Get(':userId/roles')
  @RequirePermissions('roles:read')
  getRoles(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.getRoles(user, userId);
  }

  @Post(':userId/roles')
  @RequirePermissions('roles:manage')
  assignRole(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: AssignUserRoleDto,
  ) {
    return this.users.assignRole(user, userId, input);
  }

  @Delete(':userId/roles/:roleId')
  @RequirePermissions('roles:manage')
  removeRole(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.users.removeRole(user, userId, roleId);
  }

  @Get(':userId/permission-overrides')
  @RequirePermissions('roles:read')
  getOverrides(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.getOverrides(user, userId);
  }

  @Post(':userId/permission-overrides')
  @RequirePermissions('roles:manage')
  addOverride(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: CreatePermissionOverrideDto,
  ) {
    return this.users.addOverride(user, userId, input);
  }

  @Delete(':userId/permission-overrides/:overrideId')
  @RequirePermissions('roles:manage')
  removeOverride(
    @CurrentUser() user: SupabaseUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('overrideId', ParseUUIDPipe) overrideId: string,
  ) {
    return this.users.removeOverride(user, userId, overrideId);
  }
}
