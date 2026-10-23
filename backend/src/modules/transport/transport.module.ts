import { Module } from '@nestjs/common';
import { StudentTransportController, TransportController } from './transport.controller';
import { TransportService } from './transport.service';

@Module({
  controllers: [TransportController, StudentTransportController],
  providers: [TransportService],
})
export class TransportModule {}
