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
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { SubjectsService } from './subjects.service';

@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Post()
  @RequirePermissions('subjects:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateSubjectDto) {
    return this.subjects.create(user, input);
  }

  @Get()
  @RequirePermissions('subjects:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.subjects.findMany(user, academicYearId);
  }

  @Get(':subjectId')
  @RequirePermissions('subjects:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    return this.subjects.findOne(user, subjectId);
  }

  @Patch(':subjectId')
  @RequirePermissions('subjects:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() input: UpdateSubjectDto,
  ) {
    return this.subjects.update(user, subjectId, input);
  }
}
