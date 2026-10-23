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
  AssignSubstituteDto,
  CreateSlotDto,
  CreateSubstituteRequestDto,
  CreateTimetableDto,
  GenerateDraftDto,
  SlotQueryDto,
  SubstituteQueryDto,
  UpdateSlotDto,
} from './dto/timetables.dto';
import { TimetablesService } from './timetables.service';

@Controller('timetables')
export class TimetablesController {
  constructor(private readonly timetables: TimetablesService) {}

  @Get()
  @RequirePermissions('timetable:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
    @Query('sectionId', new ParseUUIDPipe({ optional: true })) sectionId?: string,
  ) {
    return this.timetables.findMany(user, academicYearId, sectionId);
  }

  @Post()
  @RequirePermissions('timetable:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateTimetableDto) {
    return this.timetables.create(user, input);
  }

  @Post('generate-draft')
  @RequirePermissions('timetable:manage')
  generate(@CurrentUser() user: SupabaseUser, @Body() input: GenerateDraftDto) {
    return this.timetables.generateDraft(user, input);
  }

  @Get(':timetableId')
  @RequirePermissions('timetable:read')
  findOne(@CurrentUser() user: SupabaseUser, @Param('timetableId', ParseUUIDPipe) id: string) {
    return this.timetables.findOne(user, id);
  }

  @Patch(':timetableId')
  @RequirePermissions('timetable:manage')
  reopen(@CurrentUser() user: SupabaseUser, @Param('timetableId', ParseUUIDPipe) id: string) {
    return this.timetables.reopen(user, id);
  }

  @Post(':timetableId/validate')
  @RequirePermissions('timetable:manage')
  validate(@CurrentUser() user: SupabaseUser, @Param('timetableId', ParseUUIDPipe) id: string) {
    return this.timetables.validate(user, id);
  }

  @Post(':timetableId/publish')
  @RequirePermissions('timetable:manage')
  publish(@CurrentUser() user: SupabaseUser, @Param('timetableId', ParseUUIDPipe) id: string) {
    return this.timetables.setStatus(user, id, 'PUBLISHED');
  }

  @Post(':timetableId/lock')
  @RequirePermissions('timetable:manage')
  lock(@CurrentUser() user: SupabaseUser, @Param('timetableId', ParseUUIDPipe) id: string) {
    return this.timetables.setStatus(user, id, 'LOCKED');
  }
}

@Controller('timetable-slots')
export class TimetableSlotsController {
  constructor(private readonly timetables: TimetablesService) {}

  @Get()
  @RequirePermissions('timetable:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: SlotQueryDto) {
    return this.timetables.findSlots(user, query);
  }

  @Post()
  @RequirePermissions('timetable:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateSlotDto) {
    return this.timetables.createSlot(user, input);
  }

  @Patch(':slotId')
  @RequirePermissions('timetable:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() input: UpdateSlotDto,
  ) {
    return this.timetables.updateSlot(user, slotId, input);
  }

  @Delete(':slotId')
  @RequirePermissions('timetable:manage')
  remove(@CurrentUser() user: SupabaseUser, @Param('slotId', ParseUUIDPipe) slotId: string) {
    return this.timetables.deleteSlot(user, slotId);
  }
}

@Controller()
export class TimetableViewsController {
  constructor(private readonly timetables: TimetablesService) {}

  @Get('teachers/:teacherId/timetable')
  @RequirePermissions('timetable:read')
  teacher(@CurrentUser() user: SupabaseUser, @Param('teacherId', ParseUUIDPipe) teacherId: string) {
    return this.timetables.teacherTimetable(user, teacherId);
  }

  @Get('sections/:sectionId/timetable')
  @RequirePermissions('timetable:read')
  section(@CurrentUser() user: SupabaseUser, @Param('sectionId', ParseUUIDPipe) sectionId: string) {
    return this.timetables.sectionTimetable(user, sectionId);
  }
}

@Controller('substitute-requests')
export class SubstitutesController {
  constructor(private readonly timetables: TimetablesService) {}

  @Get()
  @RequirePermissions('substitutes:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: SubstituteQueryDto) {
    return this.timetables.findSubstitutes(user, query);
  }

  @Post()
  @RequirePermissions('substitutes:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateSubstituteRequestDto) {
    return this.timetables.createSubstitute(user, input);
  }

  @Get(':requestId')
  @RequirePermissions('substitutes:read')
  findOne(@CurrentUser() user: SupabaseUser, @Param('requestId', ParseUUIDPipe) id: string) {
    return this.timetables.findSubstitute(user, id);
  }

  @Get(':requestId/available-teachers')
  @RequirePermissions('substitutes:manage')
  available(@CurrentUser() user: SupabaseUser, @Param('requestId', ParseUUIDPipe) id: string) {
    return this.timetables.availableTeachers(user, id);
  }

  @Post(':requestId/assign')
  @RequirePermissions('substitutes:manage')
  assign(
    @CurrentUser() user: SupabaseUser,
    @Param('requestId', ParseUUIDPipe) id: string,
    @Body() input: AssignSubstituteDto,
  ) {
    return this.timetables.assignSubstitute(user, id, input.staffId);
  }

  @Post(':requestId/auto-assign')
  @RequirePermissions('substitutes:manage')
  autoAssign(@CurrentUser() user: SupabaseUser, @Param('requestId', ParseUUIDPipe) id: string) {
    return this.timetables.autoAssign(user, id);
  }

  @Post(':requestId/cancel')
  @RequirePermissions('substitutes:manage')
  cancel(@CurrentUser() user: SupabaseUser, @Param('requestId', ParseUUIDPipe) id: string) {
    return this.timetables.cancelSubstitute(user, id);
  }
}
