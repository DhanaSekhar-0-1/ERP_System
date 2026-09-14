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
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { LinkStudentDto } from './dto/link-student.dto';
import { ListGuardiansDto } from './dto/list-guardians.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
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

  @Post(':guardianId/students')
  @RequirePermissions('guardians:manage')
  linkStudent(
    @CurrentUser() user: SupabaseUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() input: LinkStudentDto,
  ) {
    return this.guardians.linkStudent(user, guardianId, input);
  }
}
