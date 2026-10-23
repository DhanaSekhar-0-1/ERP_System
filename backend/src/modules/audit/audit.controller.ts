import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { RawResponse } from '../../common/http/response.interceptor';
import { AuditQueryDto, SecurityQueryDto } from './dto/audit.dto';
import { AuditLogsService } from './audit.service';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly audit: AuditLogsService) {}

  @Get()
  @RequirePermissions('audit:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: AuditQueryDto) {
    return this.audit.findMany(user, query);
  }

  @Get('export')
  @RequirePermissions('audit:read')
  @RawResponse()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  export(@CurrentUser() user: SupabaseUser, @Query() query: AuditQueryDto) {
    return this.audit.exportCsv(user, query);
  }

  @Get('entity/:entityType/:entityId')
  @RequirePermissions('audit:read')
  forEntity(
    @CurrentUser() user: SupabaseUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.audit.forEntity(user, entityType, entityId);
  }

  @Get(':auditLogId')
  @RequirePermissions('audit:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('auditLogId', ParseUUIDPipe) auditLogId: string,
  ) {
    return this.audit.findOne(user, auditLogId);
  }
}

@Controller('security-events')
export class SecurityEventsController {
  constructor(private readonly audit: AuditLogsService) {}

  @Get()
  @RequirePermissions('security:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: SecurityQueryDto) {
    return this.audit.securityEvents(user, query);
  }

  @Get('login-attempts')
  @RequirePermissions('security:read')
  loginAttempts(@CurrentUser() user: SupabaseUser, @Query() query: SecurityQueryDto) {
    return this.audit.loginAttempts(user, query);
  }

  @Get('suspicious-activity')
  @RequirePermissions('security:read')
  suspicious(@CurrentUser() user: SupabaseUser) {
    return this.audit.suspiciousActivity(user);
  }

  @Post(':eventId/acknowledge')
  @RequirePermissions('security:manage')
  acknowledge(
    @CurrentUser() user: SupabaseUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.audit.acknowledge(user, eventId);
  }
}
