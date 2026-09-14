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
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { SectionsService } from './sections.service';

@Controller('sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Post()
  @RequirePermissions('sections:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateSectionDto) {
    return this.sections.create(user, input);
  }

  @Get()
  @RequirePermissions('sections:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('classId') classId?: string,
  ) {
    return this.sections.findMany(user, classId);
  }

  @Get(':sectionId')
  @RequirePermissions('sections:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ) {
    return this.sections.findOne(user, sectionId);
  }

  @Patch(':sectionId')
  @RequirePermissions('sections:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() input: UpdateSectionDto,
  ) {
    return this.sections.update(user, sectionId, input);
  }
}
