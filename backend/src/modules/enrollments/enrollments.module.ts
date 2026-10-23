import { Module } from '@nestjs/common';
import {
  EnrollmentsController,
  StudentEnrollmentsController,
} from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

@Module({
  controllers: [EnrollmentsController, StudentEnrollmentsController],
  providers: [EnrollmentsService],
})
export class EnrollmentsModule {}
