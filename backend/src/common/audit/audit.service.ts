import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AccessContext } from '../access/access.service';
import { currentRequest } from '../http/request-context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  approvalRequestId?: string;
  metadata?: Record<string, unknown>;
  schoolId?: string | null;
}

type AuditWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  /** Appends an audit entry; pass the transaction client to keep it atomic with the change. */
  async record(
    actor: AccessContext | null,
    entry: AuditEntry,
    client: AuditWriter = this.database,
  ): Promise<void> {
    const request = currentRequest();
    await client.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        schoolId: entry.schoolId ?? actor?.schoolId ?? null,
        organizationId: actor?.organizationId ?? null,
        actorRole: actor?.roles.join(', ') || null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        fieldName: entry.fieldName,
        oldValue: this.json(entry.oldValue),
        newValue: this.json(entry.newValue),
        reason: entry.reason,
        approvalRequestId: entry.approvalRequestId,
        requestId: request?.requestId,
        ipAddress: request?.ipAddress,
        userAgent: request?.userAgent,
        metadata: this.json(entry.metadata),
      },
    });
  }

  /** Records only the fields that actually changed between two snapshots. */
  changes<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    for (const key of Object.keys(after)) {
      const next = after[key];
      if (next === undefined) continue;
      const previous = before[key];
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        oldValue[key] = previous;
        newValue[key] = next;
      }
    }
    return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
  }

  private json(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
