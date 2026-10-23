import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  schoolId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Creates in-app notifications and queues delivery rows for the channels a user enabled.
 * External push/SMS/email delivery is picked up from the QUEUED rows by a worker.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private readonly database: DatabaseService) {}

  async toUsers(userIds: string[], input: NotificationInput): Promise<number> {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (!unique.length) return 0;
    const preferences = await this.database.notificationPreference.findMany({
      where: { userId: { in: unique } },
    });
    const byUser = new Map(preferences.map((preference) => [preference.userId, preference]));
    let created = 0;
    for (const userId of unique) {
      const preference = byUser.get(userId);
      if (preference?.mutedTypes.includes(input.type)) continue;
      const channels = ['IN_APP'];
      if (!preference || preference.push) channels.push('PUSH');
      if (preference?.sms) channels.push('SMS');
      if (preference?.email) channels.push('EMAIL');
      try {
        await this.database.notification.create({
          data: {
            userId,
            schoolId: input.schoolId ?? null,
            type: input.type,
            title: input.title,
            body: input.body,
            data: input.data as Prisma.InputJsonValue | undefined,
            deliveries: {
              create: channels.map((channel) => ({
                channel,
                status: channel === 'IN_APP' ? 'SENT' : 'QUEUED',
              })),
            },
          },
        });
        created += 1;
      } catch (error) {
        this.logger.warn(`Notification for ${userId} failed: ${String(error)}`);
      }
    }
    return created;
  }

  /** Notifies every active user in a school holding one of the given roles. */
  async toRoles(schoolId: string, roleNames: string[], input: NotificationInput) {
    const users = await this.database.user.findMany({
      where: {
        schoolId,
        status: 'ACTIVE',
        roles: { some: { role: { name: { in: roleNames } } } },
      },
      select: { id: true },
    });
    return this.toUsers(
      users.map((user) => user.id),
      { ...input, schoolId },
    );
  }

  /** Notifies a student's own account and every linked guardian account. */
  async toStudentFamily(studentId: string, input: NotificationInput) {
    const student = await this.database.student.findUnique({
      where: { id: studentId },
      select: {
        schoolId: true,
        userId: true,
        guardians: { select: { guardian: { select: { userId: true } } } },
      },
    });
    if (!student) return 0;
    const userIds = [
      student.userId,
      ...student.guardians.map(({ guardian }) => guardian.userId),
    ].filter((id): id is string => Boolean(id));
    return this.toUsers(userIds, { ...input, schoolId: student.schoolId });
  }
}
