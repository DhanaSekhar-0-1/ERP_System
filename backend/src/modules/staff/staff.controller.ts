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
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@RequirePermissions('users:manage')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateStaffDto) {
    return this.staff.create(user, input);
  }

  @Get()
  findMany(@CurrentUser() user: SupabaseUser) {
    return this.staff.findMany(user);
  }

  @Get(':staffId')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ) {
    return this.staff.findOne(user, staffId);
  }

  @Patch(':staffId')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() input: UpdateStaffDto,
  ) {
    return this.staff.update(user, staffId, input);
  }
}
