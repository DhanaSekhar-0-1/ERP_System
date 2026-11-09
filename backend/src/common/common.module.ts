import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AccessCacheInterceptor } from './access/access-cache.interceptor';
import { AccessService } from './access/access.service';
import { ApprovalEngine } from './approvals/approval-engine.service';
import { AuditService } from './audit/audit.service';
import { DeliveryWorker } from './notify/delivery-worker.service';
import { NotifyService } from './notify/notify.service';

@Global()
@Module({
  providers: [
    AccessService,
    AuditService,
    NotifyService,
    DeliveryWorker,
    ApprovalEngine,
    { provide: APP_INTERCEPTOR, useClass: AccessCacheInterceptor },
  ],
  exports: [AccessService, AuditService, NotifyService, DeliveryWorker, ApprovalEngine],
})
export class CommonModule {}
