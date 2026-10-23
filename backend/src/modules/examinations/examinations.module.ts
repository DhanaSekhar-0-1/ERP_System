import { Module } from '@nestjs/common';
import {
  ExaminationsController,
  MarksController,
  ReportCardsController,
} from './examinations.controller';
import { ExaminationsService } from './examinations.service';

@Module({
  controllers: [ExaminationsController, MarksController, ReportCardsController],
  providers: [ExaminationsService],
  exports: [ExaminationsService],
})
export class ExaminationsModule {}
