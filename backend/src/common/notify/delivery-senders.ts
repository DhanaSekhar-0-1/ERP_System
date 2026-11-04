import { createSign } from 'node:crypto';
import { Logger } from '@nestjs/common';

export type DeliveryChannel = 'PUSH' | 'SMS' | 'EMAIL';

export interface OutboundMessage {
  deliveryId: string;
  channel: DeliveryChannel;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
  email: string;
  phone: string | null;
  devices: { id: string; token: string; platform: string }[];
}

export interface SendResult {
  provider: string;
  recipient: string;
  messageId?: string;
  /** Device ids whose tokens the provider reported as no longer valid. */
  invalidDeviceIds?: string[];
}

/** A failure the worker should not retry (bad recipient, rejected request, missing provider). */
export class PermanentDeliveryError extends Error {}

/** The message cannot be delivered on this channel at all, e.g. no phone number or device. */
export class SkipDeliveryError extends Error {}

export interface DeliverySender {
  readonly provider: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

type Env = (name: string) => string | undefined;

/** Throws a permanent error for 4xx (other than 408/429) and a retryable one otherwise. */
async function ensureOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  const text = (await response.text()).slice(0, 500);
  const message = `${provider} responded ${response.status}: ${text}`;
  const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  throw retryable ? new Error(message) : new PermanentDeliveryError(message);
}

/** Development sender: logs the message instead of contacting a provider. */
export class ConsoleSender implements DeliverySender {
  readonly provider = 'console';
  private readonly logger = new Logger('ConsoleDelivery');

  async send(message: OutboundMessage): Promise<SendResult> {
    const recipient = recipientFor(message);
    this.logger.log(`${message.channel} -> ${recipient}: ${message.subject} | ${message.body}`);
    return { provider: this.provider, recipient, messageId: `console-${message.deliveryId}` };
  }
}

function recipientFor(message: OutboundMessage): string {
  if (message.channel === 'EMAIL') return message.email;
  if (message.channel === 'SMS') {
    if (!message.phone) throw new SkipDeliveryError('User has no phone number');
    return message.phone;
  }
  if (!message.devices.length) throw new SkipDeliveryError('User has no registered devices');
  return message.devices.map((device) => device.platform).join(',');
}

/** Firebase Cloud Messaging HTTP v1 using a service account (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY). */
export class FcmSender implements DeliverySender {
  readonly provider = 'fcm';
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly projectId: string,
    private readonly clientEmail: string,
    private readonly privateKey: string,
  ) {}

  static fromEnv(env: Env): FcmSender | null {
    const projectId = env('FCM_PROJECT_ID');
    const clientEmail = env('FCM_CLIENT_EMAIL');
    const privateKey = env('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    return projectId && clientEmail && privateKey
      ? new FcmSender(projectId, clientEmail, privateKey)
      : null;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    recipientFor(message);
    const token = await this.token();
    const data = Object.fromEntries(
      Object.entries(message.data ?? {}).map(([key, value]) => [key, String(value)]),
    );
    const invalidDeviceIds: string[] = [];
    const messageIds: string[] = [];
    let lastError: Error | undefined;
    for (const device of message.devices) {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: { title: message.subject, body: message.body },
              data: { ...data, deliveryId: message.deliveryId },
            },
          }),
        },
      );
      if (response.ok) {
        messageIds.push(((await response.json()) as { name: string }).name);
        continue;
      }
      if (response.status === 404 || response.status === 400) {
        invalidDeviceIds.push(device.id);
      }
      try {
        await ensureOk(response, this.provider);
      } catch (error) {
        lastError = error as Error;
      }
    }
    if (!messageIds.length) {
      if (invalidDeviceIds.length === message.devices.length) {
        throw Object.assign(new PermanentDeliveryError('All device tokens are invalid'), {
          invalidDeviceIds,
        });
      }
      throw lastError ?? new Error('FCM delivery failed');
    }
    return {
      provider: this.provider,
      recipient: `${messageIds.length} device(s)`,
      messageId: messageIds.join(','),
      invalidDeviceIds,
    };
  }

  /** Exchanges a signed service-account JWT for an OAuth access token, cached until shortly before expiry. */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: this.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.privateKey, 'base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    await ensureOk(response, 'google-oauth');
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}

/** Twilio Programmable SMS (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER). */
export class TwilioSmsSender implements DeliverySender {
  readonly provider = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}

  static fromEnv(env: Env): TwilioSmsSender | null {
    const sid = env('TWILIO_ACCOUNT_SID');
    const authToken = env('TWILIO_AUTH_TOKEN');
    const from = env('TWILIO_FROM_NUMBER');
    return sid && authToken && from ? new TwilioSmsSender(sid, authToken, from) : null;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = recipientFor(message);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: this.from, Body: message.body }),
      },
    );
    await ensureOk(response, this.provider);
    const json = (await response.json()) as { sid: string };
    return { provider: this.provider, recipient: to, messageId: json.sid };
  }
}

/** Resend transactional email (RESEND_API_KEY, EMAIL_FROM). */
export class ResendEmailSender implements DeliverySender {
  readonly provider = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  static fromEnv(env: Env): ResendEmailSender | null {
    const apiKey = env('RESEND_API_KEY');
    const from = env('EMAIL_FROM');
    return apiKey && from ? new ResendEmailSender(apiKey, from) : null;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = recipientFor(message);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject: message.subject, text: message.body }),
    });
    await ensureOk(response, this.provider);
    const json = (await response.json()) as { id: string };
    return { provider: this.provider, recipient: to, messageId: json.id };
  }
}

/**
 * Picks the configured provider per channel. Without one, development uses the console
 * sender and production returns null so the delivery fails visibly.
 */
export function buildSenders(env: Env): Record<DeliveryChannel, DeliverySender | null> {
  const fallback = env('NODE_ENV') === 'production' ? null : new ConsoleSender();
  return {
    PUSH: FcmSender.fromEnv(env) ?? fallback,
    SMS: TwilioSmsSender.fromEnv(env) ?? fallback,
    EMAIL: ResendEmailSender.fromEnv(env) ?? fallback,
  };
}
