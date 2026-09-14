import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { AcademicYearsService } from './academic-years.service';

@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly academicYears: AcademicYearsService) {}

  @Post()
  @RequirePermissions('academic-years:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateAcademicYearDto) {
    return this.academicYears.create(user, input);
  }

  @Get()
  @RequirePermissions('academic-years:read')
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.academicYears.findMany(user);
  }

  @Get(':academicYearId')
  @RequirePermissions('academic-years:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('academicYearId', ParseUUIDPipe) academicYearId: string,
  ) {
    return this.academicYears.findOne(user, academicYearId);
  }

  @Patch(':academicYearId')
  @RequirePermissions('academic-years:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('academicYearId', ParseUUIDPipe) academicYearId: string,
    @Body() input: UpdateAcademicYearDto,
  ) {
    return this.academicYears.update(user, academicYearId, input);
  }

  @Post(':academicYearId/activate')
  @RequirePermissions('academic-years:manage')
  activate(
    @CurrentUser() user: SupabaseUser,
    @Param('academicYearId', ParseUUIDPipe) academicYearId: string,
  ) {
    return this.academicYears.activate(user, academicYearId);
  }
}
