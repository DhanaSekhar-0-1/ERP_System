import { Module } from '@nestjs/common';
import { ComplaintsController, FeedbackController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';

@Module({
  controllers: [FeedbackController, ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
