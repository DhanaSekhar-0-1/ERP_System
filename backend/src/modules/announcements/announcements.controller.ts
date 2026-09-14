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
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermissions('announcements:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query('status') status?: string) {
    return this.announcements.findMany(user, status);
  }

  @Post()
  @RequirePermissions('announcements:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateAnnouncementDto) {
    return this.announcements.create(user, input);
  }

  @Get(':announcementId')
  @RequirePermissions('announcements:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
  ) {
    return this.announcements.findOne(user, announcementId);
  }

  @Patch(':announcementId')
  @RequirePermissions('announcements:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @Body() input: UpdateAnnouncementDto,
  ) {
    return this.announcements.update(user, announcementId, input);
  }

  @Delete(':announcementId')
  @RequirePermissions('announcements:manage')
  remove(
    @CurrentUser() user: SupabaseUser,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
  ) {
    return this.announcements.remove(user, announcementId);
  }

  @Post(':announcementId/publish')
  @RequirePermissions('announcements:manage')
  publish(
    @CurrentUser() user: SupabaseUser,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
  ) {
    return this.announcements.publish(user, announcementId);
  }

  @Post(':announcementId/archive')
  @RequirePermissions('announcements:manage')
  archive(
    @CurrentUser() user: SupabaseUser,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
  ) {
    return this.announcements.archive(user, announcementId);
  }
}
