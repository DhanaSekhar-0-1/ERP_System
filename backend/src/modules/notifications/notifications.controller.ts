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
  CreateTemplateDto,
  NotificationQueryDto,
  RegisterDeviceDto,
  TestNotificationDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  findMine(@CurrentUser() user: SupabaseUser, @Query() query: NotificationQueryDto) {
    return this.notifications.findMine(user, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: SupabaseUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: SupabaseUser) {
    return this.notifications.markAllRead(user);
  }

  @Post('test')
  @RequirePermissions('notifications:manage')
  test(@CurrentUser() user: SupabaseUser, @Body() input: TestNotificationDto) {
    return this.notifications.test(user, input);
  }

  @Post(':notificationId/read')
  read(
    @CurrentUser() user: SupabaseUser,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markRead(user, notificationId);
  }
}

@Controller()
export class NotificationSettingsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notification-preferences')
  preferences(@CurrentUser() user: SupabaseUser) {
    return this.notifications.preferences(user);
  }

  @Patch('notification-preferences')
  updatePreferences(@CurrentUser() user: SupabaseUser, @Body() input: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(user, input);
  }

  @Post('devices')
  registerDevice(@CurrentUser() user: SupabaseUser, @Body() input: RegisterDeviceDto) {
    return this.notifications.registerDevice(user, input);
  }

  @Delete('devices/:deviceId')
  removeDevice(
    @CurrentUser() user: SupabaseUser,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.notifications.removeDevice(user, deviceId);
  }

  @Get('notification-templates')
  @RequirePermissions('notifications:manage')
  templates(@CurrentUser() user: SupabaseUser) {
    return this.notifications.templates(user);
  }

  @Post('notification-templates')
  @RequirePermissions('notifications:manage')
  createTemplate(@CurrentUser() user: SupabaseUser, @Body() input: CreateTemplateDto) {
    return this.notifications.createTemplate(user, input);
  }

  @Patch('notification-templates/:templateId')
  @RequirePermissions('notifications:manage')
  updateTemplate(
    @CurrentUser() user: SupabaseUser,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() input: UpdateTemplateDto,
  ) {
    return this.notifications.updateTemplate(user, templateId, input);
  }

  @Get('notification-deliveries')
  @RequirePermissions('notifications:manage')
  deliveries(@CurrentUser() user: SupabaseUser, @Query() query: NotificationQueryDto) {
    return this.notifications.deliveries(user, query);
  }
}
