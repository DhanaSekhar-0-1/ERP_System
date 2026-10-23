import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import {
  ResolveConflictDto,
  SyncAttendanceDto,
  SyncBatchDto,
  SyncMarksDto,
} from './dto/sync.dto';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('batches')
  @RequirePermissions('sync:write')
  batch(@CurrentUser() user: SupabaseUser, @Body() input: SyncBatchDto) {
    return this.sync.batch(user, input);
  }

  @Get('batches/:batchId')
  @RequirePermissions('sync:write')
  findBatch(@CurrentUser() user: SupabaseUser, @Param('batchId', ParseUUIDPipe) id: string) {
    return this.sync.findBatch(user, id);
  }

  @Post('attendance')
  @RequirePermissions('sync:write', 'attendance:manage')
  attendance(@CurrentUser() user: SupabaseUser, @Body() input: SyncAttendanceDto) {
    return this.sync.syncAttendance(user, input.deviceId, input.items);
  }

  @Post('mark-drafts')
  @RequirePermissions('sync:write', 'marks:manage')
  marks(@CurrentUser() user: SupabaseUser, @Body() input: SyncMarksDto) {
    return this.sync.syncMarks(user, input.deviceId, input.items);
  }

  @Get('conflicts')
  @RequirePermissions('sync:write')
  conflicts(@CurrentUser() user: SupabaseUser) {
    return this.sync.conflicts(user);
  }

  @Post('conflicts/:conflictId/resolve')
  @RequirePermissions('sync:manage')
  resolve(
    @CurrentUser() user: SupabaseUser,
    @Param('conflictId', ParseUUIDPipe) id: string,
    @Body() input: ResolveConflictDto,
  ) {
    return this.sync.resolve(user, id, input);
  }

  @Get('checkpoint')
  @RequirePermissions('sync:write')
  checkpoint(@CurrentUser() user: SupabaseUser) {
    return this.sync.checkpoint(user);
  }
}
