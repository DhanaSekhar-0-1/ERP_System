import { Global, Module } from '@nestjs/common';
import { AccessService } from './access/access.service';
import { ApprovalEngine } from './approvals/approval-engine.service';
import { AuditService } from './audit/audit.service';
import { DeliveryWorker } from './notify/delivery-worker.service';
import { NotifyService } from './notify/notify.service';

@Global()
@Module({
  providers: [AccessService, AuditService, NotifyService, DeliveryWorker, ApprovalEngine],
  exports: [AccessService, AuditService, NotifyService, DeliveryWorker, ApprovalEngine],
})
export class CommonModule {}
