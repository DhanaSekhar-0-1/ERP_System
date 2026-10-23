import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { InsightsService } from './insights.service';

class RangeDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

class PerformanceQueryDto {
  @IsOptional()
  @IsUUID()
  examinationId?: string;
}

class RiskQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  threshold?: number;
}

@Controller()
export class DashboardsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('dashboards/principal')
  @RequirePermissions('dashboards:read')
  principal(@CurrentUser() user: SupabaseUser) {
    return this.insights.principal(user);
  }

  @Get('dashboards/teacher')
  @RequirePermissions('dashboards:read')
  teacher(@CurrentUser() user: SupabaseUser) {
    return this.insights.teacher(user);
  }

  @Get('dashboards/parent')
  @RequirePermissions('dashboards:read')
  parent(@CurrentUser() user: SupabaseUser) {
    return this.insights.parent(user);
  }

  @Get('dashboards/accountant')
  @RequirePermissions('dashboards:read')
  accountant(@CurrentUser() user: SupabaseUser) {
    return this.insights.accountant(user);
  }

  @Get('teachers/:teacherId/today')
  @RequirePermissions('dashboards:read')
  teacherToday(@CurrentUser() user: SupabaseUser, @Param('teacherId', ParseUUIDPipe) teacherId: string) {
    return this.insights.teacherToday(user, teacherId);
  }

  @Get('teachers/:teacherId/pending-work')
  @RequirePermissions('dashboards:read')
  pendingWork(@CurrentUser() user: SupabaseUser, @Param('teacherId', ParseUUIDPipe) teacherId: string) {
    return this.insights.teacherPendingWork(user, teacherId);
  }

  @Get('parents/:parentId/children-summary')
  @RequirePermissions('dashboards:read')
  childrenSummary(@CurrentUser() user: SupabaseUser, @Param('parentId', ParseUUIDPipe) parentId: string) {
    return this.insights.parentChildren(user, parentId);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('attendance-summary')
  @RequirePermissions('reports:read')
  attendance(@CurrentUser() user: SupabaseUser, @Query() query: RangeDto) {
    return this.insights.attendanceReport(user, query.from, query.to);
  }

  @Get('fee-summary')
  @RequirePermissions('reports:read')
  fees(@CurrentUser() user: SupabaseUser) {
    return this.insights.accountant(user);
  }

  @Get('examination-status')
  @RequirePermissions('reports:read')
  exams(@CurrentUser() user: SupabaseUser) {
    return this.insights.examinationStatusReport(user);
  }

  @Get('pending-approvals')
  @RequirePermissions('reports:read')
  approvals(@CurrentUser() user: SupabaseUser) {
    return this.insights.pendingApprovalsReport(user);
  }

  @Get('complaint-summary')
  @RequirePermissions('reports:read')
  complaints(@CurrentUser() user: SupabaseUser) {
    return this.insights.complaintReport(user);
  }

  @Get('collections')
  @RequirePermissions('reports:read')
  collections(@CurrentUser() user: SupabaseUser, @Query() query: RangeDto) {
    return this.insights.collectionsReport(user, query.from, query.to);
  }

  @Get('overdue-fees')
  @RequirePermissions('reports:read')
  overdue(@CurrentUser() user: SupabaseUser) {
    return this.insights.accountant(user);
  }

  @Get('reconciliation')
  @RequirePermissions('reports:read')
  reconciliation(@CurrentUser() user: SupabaseUser, @Query() query: RangeDto) {
    return this.insights.reconciliationReport(user, query.from, query.to);
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('attendance')
  @RequirePermissions('analytics:read')
  attendance(@CurrentUser() user: SupabaseUser, @Query() query: RangeDto) {
    return this.insights.attendanceTrend(user, query.from, query.to);
  }

  @Get('academic-performance')
  @RequirePermissions('analytics:read')
  performance(@CurrentUser() user: SupabaseUser, @Query() query: PerformanceQueryDto) {
    return this.insights.academicPerformance(user, query.examinationId);
  }

  @Get('fee-collection')
  @RequirePermissions('analytics:read')
  fees(@CurrentUser() user: SupabaseUser) {
    return this.insights.feeCollectionTrend(user);
  }

  @Get('teacher-workload')
  @RequirePermissions('analytics:read')
  workload(@CurrentUser() user: SupabaseUser) {
    return this.insights.teacherWorkload(user);
  }

  @Get('complaints')
  @RequirePermissions('analytics:read')
  complaints(@CurrentUser() user: SupabaseUser) {
    return this.insights.complaintTrend(user);
  }

  @Get('attendance-risk')
  @RequirePermissions('analytics:read')
  risk(@CurrentUser() user: SupabaseUser, @Query() query: RiskQueryDto) {
    return this.insights.attendanceRisk(user, query.threshold);
  }
}
