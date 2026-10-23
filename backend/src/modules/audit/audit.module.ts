import { Module } from '@nestjs/common';
import { AuditLogsController, SecurityEventsController } from './audit.controller';
import { AuditLogsService } from './audit.service';

@Module({
  controllers: [AuditLogsController, SecurityEventsController],
  providers: [AuditLogsService],
})
export class AuditModule {}
