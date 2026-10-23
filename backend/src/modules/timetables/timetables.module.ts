import { Module } from '@nestjs/common';
import {
  SubstitutesController,
  TimetableSlotsController,
  TimetableViewsController,
  TimetablesController,
} from './timetables.controller';
import { TimetablesService } from './timetables.service';

@Module({
  controllers: [
    TimetablesController,
    TimetableSlotsController,
    TimetableViewsController,
    SubstitutesController,
  ],
  providers: [TimetablesService],
})
export class TimetablesModule {}
