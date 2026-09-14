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
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { ClassesService } from './classes.service';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Post()
  @RequirePermissions('classes:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateClassDto) {
    return this.classes.create(user, input);
  }

  @Get()
  @RequirePermissions('classes:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.classes.findMany(user, academicYearId);
  }

  @Get(':classId')
  @RequirePermissions('classes:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    return this.classes.findOne(user, classId);
  }

  @Patch(':classId')
  @RequirePermissions('classes:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() input: UpdateClassDto,
  ) {
    return this.classes.update(user, classId, input);
  }
}
