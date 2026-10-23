import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { pageArgs, paged } from '../../common/http/pagination';
import { AuditQueryDto, SecurityQueryDto } from './dto/audit.dto';

/** Read-only access to the append-only audit trail; there are no update or delete routes. */
@Injectable()
export class AuditLogsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
  ) {}

  async findMany(authUser: SupabaseUser, query: AuditQueryDto) {
    const context = await this.leader(authUser);
    const where = this.where(context, query);
    const [items, total] = await this.database.$transaction([
      this.database.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, displayName: true, email: true } } },
        ...pageArgs(query),
      }),
      this.database.auditLog.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async findOne(authUser: SupabaseUser, auditLogId: string) {
    const context = await this.leader(authUser);
    const entry = await this.database.auditLog.findFirst({
      where: { id: auditLogId, schoolId: context.schoolId },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    if (!entry) throw new NotFoundException('Audit entry not found');
    return entry;
  }

  async forEntity(authUser: SupabaseUser, entityType: string, entityId: string) {
    const context = await this.leader(authUser);
    return this.database.auditLog.findMany({
      where: { schoolId: context.schoolId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, displayName: true } } },
    });
  }

  async exportCsv(authUser: SupabaseUser, query: AuditQueryDto): Promise<string> {
    const context = await this.leader(authUser);
    const entries = await this.database.auditLog.findMany({
      where: this.where(context, query),
      orderBy: { createdAt: 'asc' },
      take: 50000,
      include: { user: { select: { email: true } } },
    });
    const rows = [
      ['created_at', 'actor', 'actor_role', 'action', 'entity_type', 'entity_id', 'reason', 'old_value', 'new_value', 'ip_address', 'request_id'],
      ...entries.map((entry) => [
        entry.createdAt.toISOString(),
        entry.user?.email ?? '',
        entry.actorRole ?? '',
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.reason ?? '',
        entry.oldValue ? JSON.stringify(entry.oldValue) : '',
        entry.newValue ? JSON.stringify(entry.newValue) : '',
        entry.ipAddress ?? '',
        entry.requestId ?? '',
      ]),
    ];
    return rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  async securityEvents(authUser: SupabaseUser, query: SecurityQueryDto) {
    await this.leader(authUser);
    const where: Prisma.SecurityEventWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.securityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.database.securityEvent.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async loginAttempts(authUser: SupabaseUser, query: SecurityQueryDto) {
    await this.leader(authUser);
    const [items, total] = await this.database.$transaction([
      this.database.loginAttempt.findMany({ orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.database.loginAttempt.count(),
    ]);
    return paged(items, total, query);
  }

  /** Identifiers and IP addresses with repeated failures in the last 24 hours. */
  async suspiciousActivity(authUser: SupabaseUser) {
    await this.leader(authUser);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [byIdentifier, byIp] = await Promise.all([
      this.database.loginAttempt.groupBy({
        by: ['identifier'],
        where: { success: false, createdAt: { gte: since } },
        _count: { _all: true },
        having: { identifier: { _count: { gte: 3 } } },
      }),
      this.database.loginAttempt.groupBy({
        by: ['ipAddress'],
        where: { success: false, createdAt: { gte: since }, ipAddress: { not: null } },
        _count: { _all: true },
        having: { ipAddress: { _count: { gte: 5 } } },
      }),
    ]);
    return {
      since,
      failedByIdentifier: byIdentifier.map((row) => ({ identifier: row.identifier, failures: row._count._all })),
      failedByIp: byIp.map((row) => ({ ipAddress: row.ipAddress, failures: row._count._all })),
    };
  }

  async acknowledge(authUser: SupabaseUser, eventId: string) {
    const context = await this.leader(authUser);
    const event = await this.database.securityEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Security event not found');
    return this.database.securityEvent.update({
      where: { id: eventId },
      data: { acknowledgedAt: new Date(), acknowledgedById: context.userId },
    });
  }

  private async leader(authUser: SupabaseUser): Promise<SchoolContext> {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    return context;
  }

  private where(context: SchoolContext, query: AuditQueryDto): Prisma.AuditLogWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);
    return {
      schoolId: context.schoolId,
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
  }
}
