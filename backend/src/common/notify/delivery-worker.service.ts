import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  buildSenders,
  DeliveryChannel,
  DeliverySender,
  OutboundMessage,
  PermanentDeliveryError,
  SkipDeliveryError,
} from './delivery-senders';

export const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
/** A SENDING row older than this is assumed abandoned by a crashed worker and is claimed again. */
const STALE_LOCK_MINUTES = 5;

const deliveryInclude = {
  notification: {
    include: {
      user: {
        select: {
          email: true,
          phone: true,
          guardian: { select: { phone: true } },
          devices: { select: { id: true, token: true, platform: true } },
        },
      },
    },
  },
} satisfies Prisma.NotificationDeliveryInclude;

type LoadedDelivery = Prisma.NotificationDeliveryGetPayload<{ include: typeof deliveryInclude }>;

export interface ProcessSummary {
  claimed: number;
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
}

/**
 * Sends QUEUED push/SMS/email delivery rows. Rows are claimed with FOR UPDATE SKIP LOCKED,
 * so several API instances can run the worker against the same database.
 * Failed sends retry with exponential backoff up to MAX_DELIVERY_ATTEMPTS.
 */
@Injectable()
export class DeliveryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryWorker.name);
  private readonly senders: Record<DeliveryChannel, DeliverySender | null>;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.senders = buildSenders((name) => this.config.get<string>(name));
  }

  onApplicationBootstrap(): void {
    if (this.config.get<string>('NOTIFICATION_WORKER_ENABLED') === 'false') return;
    const interval = Number(this.config.get<string>('NOTIFICATION_WORKER_INTERVAL_MS') ?? 5000);
    const providers = Object.entries(this.senders)
      .map(([channel, sender]) => `${channel}=${sender?.provider ?? 'none'}`)
      .join(' ');
    this.logger.log(`Delivery worker polling every ${interval}ms (${providers})`);
    this.timer = setInterval(() => void this.tick(), interval);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    try {
      await this.processBatch();
    } catch (error) {
      this.logger.error(`Delivery batch failed: ${String(error)}`);
    }
  }

  /** Claims and sends up to `limit` due deliveries, optionally only for one school. */
  async processBatch(limit = 25, schoolId?: string): Promise<ProcessSummary> {
    const summary: ProcessSummary = { claimed: 0, sent: 0, skipped: 0, retrying: 0, failed: 0 };
    if (this.running) return summary;
    this.running = true;
    try {
      const ids = await this.claim(limit, schoolId);
      summary.claimed = ids.length;
      if (!ids.length) return summary;
      const deliveries = await this.database.notificationDelivery.findMany({
        where: { id: { in: ids } },
        include: deliveryInclude,
      });
      for (const delivery of deliveries) {
        const outcome = await this.deliver(delivery);
        summary[outcome] += 1;
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async claim(limit: number, schoolId?: string): Promise<string[]> {
    const rows = await this.database.$queryRaw<{ id: string }[]>`
      UPDATE notification_deliveries
      SET status = 'SENDING', locked_at = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1,
          updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id IN (
        SELECT d.id FROM notification_deliveries d
        JOIN notifications n ON n.id = d.notification_id
        WHERE d.channel <> 'IN_APP'
          AND (${schoolId ?? null}::uuid IS NULL OR n.school_id = ${schoolId ?? null}::uuid)
          AND (
            (d.status = 'QUEUED' AND d.next_attempt_at <= (now() AT TIME ZONE 'UTC'))
            OR (d.status = 'SENDING'
                AND d.locked_at < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${STALE_LOCK_MINUTES}::int))
          )
        ORDER BY d.next_attempt_at
        LIMIT ${limit}
        FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING id`;
    return rows.map((row) => row.id);
  }

  private async deliver(delivery: LoadedDelivery): Promise<'sent' | 'skipped' | 'retrying' | 'failed'> {
    const { notification } = delivery;
    const channel = delivery.channel as DeliveryChannel;
    const sender = this.senders[channel];
    try {
      if (!sender) throw new PermanentDeliveryError(`No ${channel} provider configured`);
      const rendered = await this.render(notification, channel);
      const message: OutboundMessage = {
        deliveryId: delivery.id,
        channel,
        subject: rendered.subject,
        body: rendered.body,
        data: (notification.data as Record<string, unknown> | null) ?? undefined,
        email: notification.user.email,
        phone: notification.user.phone ?? notification.user.guardian?.phone ?? null,
        devices: notification.user.devices,
      };
      const result = await sender.send(message);
      await this.removeDevices(result.invalidDeviceIds);
      await this.database.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lockedAt: null,
          error: null,
          provider: result.provider,
          recipient: result.recipient,
          providerMessageId: result.messageId,
        },
      });
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.removeDevices((error as { invalidDeviceIds?: string[] }).invalidDeviceIds);
      if (error instanceof SkipDeliveryError) {
        await this.finish(delivery.id, 'SKIPPED', message, sender?.provider);
        return 'skipped';
      }
      if (error instanceof PermanentDeliveryError || delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
        this.logger.warn(`Delivery ${delivery.id} (${channel}) failed: ${message}`);
        await this.finish(delivery.id, 'FAILED', message, sender?.provider);
        return 'failed';
      }
      const delay = RETRY_BASE_MS * 2 ** (delivery.attempts - 1);
      await this.database.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'QUEUED',
          lockedAt: null,
          error: message,
          provider: sender?.provider,
          nextAttemptAt: new Date(Date.now() + delay),
        },
      });
      return 'retrying';
    }
  }

  private finish(id: string, status: 'SKIPPED' | 'FAILED', error: string, provider?: string) {
    return this.database.notificationDelivery.update({
      where: { id },
      data: { status, error, provider, lockedAt: null },
    });
  }

  private async removeDevices(deviceIds?: string[]): Promise<void> {
    if (deviceIds?.length) {
      await this.database.device.deleteMany({ where: { id: { in: deviceIds } } });
    }
  }

  /**
   * Applies the school's template for (notification type, channel), falling back to a global
   * template, then to the notification's own title and body. Supports {{title}}, {{body}}
   * and {{key}} for any key in the notification data.
   */
  private async render(
    notification: { schoolId: string | null; type: string; title: string; body: string; data: unknown },
    channel: DeliveryChannel,
  ): Promise<{ subject: string; body: string }> {
    const templates = await this.database.notificationTemplate.findMany({
      where: {
        code: notification.type,
        channel,
        OR: [{ schoolId: notification.schoolId }, { schoolId: null }],
      },
    });
    const template =
      templates.find((candidate) => candidate.schoolId === notification.schoolId) ?? templates[0];
    if (!template) return { subject: notification.title, body: notification.body };
    const values: Record<string, unknown> = {
      ...((notification.data as Record<string, unknown> | null) ?? {}),
      title: notification.title,
      body: notification.body,
    };
    const fill = (text: string) =>
      text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) =>
        values[key] === undefined ? match : String(values[key]),
      );
    return {
      subject: template.subject ? fill(template.subject) : notification.title,
      body: fill(template.body),
    };
  }
}
