import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService } from '../../common/access/access.service';
import { NotifyService } from '../../common/notify/notify.service';
import { pageArgs, paged } from '../../common/http/pagination';
import {
  CreateTemplateDto,
  NotificationQueryDto,
  RegisterDeviceDto,
  TestNotificationDto,
  UpdatePreferencesDto,
  UpdateTemplateDto,
} from './dto/notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
  ) {}

  async findMine(authUser: SupabaseUser, query: NotificationQueryDto) {
    const context = await this.access.context(authUser);
    const where: Prisma.NotificationWhereInput = {
      userId: context.userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.database.notification.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async unreadCount(authUser: SupabaseUser) {
    const context = await this.access.context(authUser);
    const unread = await this.database.notification.count({
      where: { userId: context.userId, readAt: null },
    });
    return { unread };
  }

  async markRead(authUser: SupabaseUser, notificationId: string) {
    const context = await this.access.context(authUser);
    const result = await this.database.notification.updateMany({
      where: { id: notificationId, userId: context.userId },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notification not found');
    return { id: notificationId, read: true };
  }

  async markAllRead(authUser: SupabaseUser) {
    const context = await this.access.context(authUser);
    const result = await this.database.notification.updateMany({
      where: { userId: context.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  async preferences(authUser: SupabaseUser) {
    const context = await this.access.context(authUser);
    return this.database.notificationPreference.upsert({
      where: { userId: context.userId },
      create: { userId: context.userId },
      update: {},
    });
  }

  async updatePreferences(authUser: SupabaseUser, input: UpdatePreferencesDto) {
    const context = await this.access.context(authUser);
    return this.database.notificationPreference.upsert({
      where: { userId: context.userId },
      create: { userId: context.userId, ...input },
      update: input,
    });
  }

  async registerDevice(authUser: SupabaseUser, input: RegisterDeviceDto) {
    const context = await this.access.context(authUser);
    return this.database.device.upsert({
      where: { token: input.token },
      create: { userId: context.userId, token: input.token, platform: input.platform },
      update: { userId: context.userId, platform: input.platform },
    });
  }

  async removeDevice(authUser: SupabaseUser, deviceId: string) {
    const context = await this.access.context(authUser);
    const result = await this.database.device.deleteMany({
      where: { id: deviceId, userId: context.userId },
    });
    if (!result.count) throw new NotFoundException('Device not found');
    return { id: deviceId, removed: true };
  }

  async templates(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.notificationTemplate.findMany({
      where: { OR: [{ schoolId: context.schoolId }, { schoolId: null }] },
      orderBy: [{ code: 'asc' }, { channel: 'asc' }],
    });
  }

  async createTemplate(authUser: SupabaseUser, input: CreateTemplateDto) {
    const context = await this.access.schoolContext(authUser);
    try {
      return await this.database.notificationTemplate.create({
        data: { schoolId: context.schoolId, ...input },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A template with this code and channel already exists');
      }
      throw error;
    }
  }

  async updateTemplate(authUser: SupabaseUser, templateId: string, input: UpdateTemplateDto) {
    const context = await this.access.schoolContext(authUser);
    const template = await this.database.notificationTemplate.findFirst({
      where: { id: templateId, schoolId: context.schoolId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return this.database.notificationTemplate.update({ where: { id: templateId }, data: input });
  }

  async deliveries(authUser: SupabaseUser, query: NotificationQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const where: Prisma.NotificationDeliveryWhereInput = {
      notification: { schoolId: context.schoolId },
    };
    const [items, total] = await this.database.$transaction([
      this.database.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { notification: { select: { type: true, title: true, userId: true } } },
        ...pageArgs(query),
      }),
      this.database.notificationDelivery.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async test(authUser: SupabaseUser, input: TestNotificationDto) {
    const context = await this.access.schoolContext(authUser);
    const userId = input.userId ?? context.userId;
    const target = await this.database.user.findFirst({
      where: { id: userId, schoolId: context.schoolId },
    });
    if (!target) throw new NotFoundException('User not found in this school');
    const sent = await this.notify.toUsers([userId], {
      type: 'test',
      title: input.title,
      body: input.body,
      schoolId: context.schoolId,
    });
    return { sent };
  }
}
