import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/auth/public.decorator';
import { DatabaseService } from '../../common/database/database.service';
import { FeesService } from './fees.service';

interface RawRequest {
  rawBody?: Buffer;
  body: unknown;
}

/**
 * Gateway callbacks. Every request is signature-verified against the raw body and
 * recorded once per provider event id, so retries never double-apply a payment.
 */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(
    private readonly fees: FeesService,
    private readonly database: DatabaseService,
  ) {}

  @Post('razorpay')
  @Public()
  @HttpCode(200)
  async razorpay(
    @Req() request: RawBodyRequest<RawRequest>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventIdHeader?: string,
  ) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Razorpay webhook secret is not configured');
    const raw = this.raw(request);
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    this.assertSignature(expected, signature);

    const body = request.body as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
    };
    const eventId = eventIdHeader ?? createHmac('sha256', 'event').update(raw).digest('hex');
    if (!(await this.firstDelivery('razorpay', eventId, body))) {
      return { received: true, duplicate: true };
    }
    const entity = body.payload?.payment?.entity;
    if (!entity?.order_id) return { received: true, ignored: true };
    const success = body.event === 'payment.captured' || body.event === 'order.paid';
    const failed = body.event === 'payment.failed';
    if (!success && !failed) return { received: true, ignored: true };
    const result = await this.fees.captureGatewayPayment(entity.order_id, entity.id, success);
    await this.markProcessed('razorpay', eventId);
    return { received: true, ...result };
  }

  @Post('cashfree')
  @Public()
  @HttpCode(200)
  async cashfree(
    @Req() request: RawBodyRequest<RawRequest>,
    @Headers('x-webhook-signature') signature?: string,
    @Headers('x-webhook-timestamp') timestamp?: string,
  ) {
    const secret = process.env.CASHFREE_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Cashfree webhook secret is not configured');
    if (!timestamp) throw new UnauthorizedException('Missing webhook timestamp');
    const raw = this.raw(request);
    const expected = createHmac('sha256', secret)
      .update(timestamp + raw.toString('utf8'))
      .digest('base64');
    this.assertSignature(expected, signature);

    const body = request.body as {
      type?: string;
      data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string | number; payment_status?: string } };
    };
    const orderId = body.data?.order?.order_id;
    const paymentId = body.data?.payment?.cf_payment_id?.toString();
    const eventId = `${orderId}:${paymentId}:${body.data?.payment?.payment_status}`;
    if (!(await this.firstDelivery('cashfree', eventId, body))) {
      return { received: true, duplicate: true };
    }
    if (!orderId) return { received: true, ignored: true };
    const status = body.data?.payment?.payment_status;
    if (status !== 'SUCCESS' && status !== 'FAILED') return { received: true, ignored: true };
    const result = await this.fees.captureGatewayPayment(orderId, paymentId, status === 'SUCCESS');
    await this.markProcessed('cashfree', eventId);
    return { received: true, ...result };
  }

  private raw(request: RawBodyRequest<RawRequest>): Buffer {
    if (!request.rawBody) throw new BadRequestException('Raw request body is unavailable');
    return request.rawBody;
  }

  private assertSignature(expected: string, provided?: string) {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private async firstDelivery(provider: string, eventId: string, payload: unknown): Promise<boolean> {
    try {
      await this.database.paymentWebhookEvent.create({
        data: { provider, eventId, payload: payload as Prisma.InputJsonValue },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  private async markProcessed(provider: string, eventId: string) {
    await this.database.paymentWebhookEvent.update({
      where: { provider_eventId: { provider, eventId } },
      data: { processedAt: new Date() },
    });
  }
}
