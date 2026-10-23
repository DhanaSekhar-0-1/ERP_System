import { Module } from '@nestjs/common';
import {
  AnalyticsController,
  DashboardsController,
  ReportsController,
} from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  controllers: [DashboardsController, ReportsController, AnalyticsController],
  providers: [InsightsService],
})
export class DashboardsModule {}
