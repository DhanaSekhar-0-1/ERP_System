import { Module } from '@nestjs/common';
import {
  NotificationSettingsController,
  NotificationsController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, NotificationSettingsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
