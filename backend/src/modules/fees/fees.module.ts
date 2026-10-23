import { Module } from '@nestjs/common';
import {
  FeeStructuresController,
  FeeViewsController,
  PaymentsController,
  StudentFeesController,
} from './fees.controller';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { FeesService } from './fees.service';

@Module({
  controllers: [
    PaymentWebhooksController,
    FeeStructuresController,
    StudentFeesController,
    PaymentsController,
    FeeViewsController,
  ],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
