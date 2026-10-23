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
  CreateGuardianAccountDto,
  CreateGuardianDto,
  LinkStudentDto,
  ListGuardiansDto,
  UpdateChildContactDto,
  UpdateGuardianDto,
  UpdateMyProfileDto,
} from './dto/guardians.dto';
import { GuardiansService } from './guardians.service';

@Controller('guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Post()
  @RequirePermissions('guardians:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateGuardianDto) {
    return this.guardians.create(user, input);
  }

  @Get()
  @RequirePermissions('guardians:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() input: ListGuardiansDto) {
    return this.guardians.findMany(user, input);
  }

  @Get(':guardianId')
  @RequirePermissions('guardians:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
  ) {
    return this.guardians.findOne(user, guardianId);
  }

  @Patch(':guardianId')
  @RequirePermissions('guardians:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() input: UpdateGuardianDto,
  ) {
    return this.guardians.update(user, guardianId, input);
  }

  @Get(':guardianId/children')
  @RequirePermissions('guardians:read')
  children(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
  ) {
    return this.guardians.children(user, guardianId);
  }

  @Post(':guardianId/children')
  @RequirePermissions('guardians:manage')
  linkChild(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() input: LinkStudentDto,
  ) {
    return this.guardians.linkStudent(user, guardianId, input);
  }

  /** Kept for existing clients; same as POST /guardians/:id/children. */
  @Post(':guardianId/students')
  @RequirePermissions('guardians:manage')
  linkStudent(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() input: LinkStudentDto,
  ) {
    return this.guardians.linkStudent(user, guardianId, input);
  }

  @Delete(':guardianId/children/:studentId')
  @RequirePermissions('guardians:manage')
  unlinkChild(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.guardians.unlinkStudent(user, guardianId, studentId);
  }

  @Post(':guardianId/account')
  @RequirePermissions('guardians:manage', 'users:manage')
  createAccount(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() input: CreateGuardianAccountDto,
  ) {
    return this.guardians.createAccount(user, guardianId, input);
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('children')
  children(@CurrentUser() user: SupabaseUser) {
    return this.guardians.myChildren(user);
  }

  @Get('children/:studentId')
  child(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.guardians.myChild(user, studentId);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: SupabaseUser, @Body() input: UpdateMyProfileDto) {
    return this.guardians.updateMyProfile(user, input);
  }

  @Patch('children/:studentId/contact-details')
  updateChildContact(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() input: UpdateChildContactDto,
  ) {
    return this.guardians.updateChildContact(user, studentId, input);
  }
}
