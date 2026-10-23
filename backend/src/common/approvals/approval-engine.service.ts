import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalRequest, Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AccessContext, SchoolContext } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { NotifyService } from '../notify/notify.service';
import { ROLE } from '../access/roles';

/** Approver slot that either a School Admin or a Principal may fill. */
export const LEADER_SLOT = 'School Admin or Principal';

export type ApprovalHandler = (
  transaction: Prisma.TransactionClient,
  request: ApprovalRequest,
  approver: AccessContext,
) => Promise<void>;

export interface ApprovalDefinition {
  onApproved: ApprovalHandler;
  onRejected?: ApprovalHandler;
}

export interface CreateApprovalInput {
  type: string;
  entityType: string;
  entityId: string;
  reason: string;
  payload?: Record<string, unknown>;
  tier: 3 | 4;
  documentFileId?: string;
}

/**
 * Tier 3 requests need one School Admin or Principal decision.
 * Tier 4 requests need both a School Admin and a Principal.
 * The registered handler applies the change inside the same transaction as the final approval.
 */
@Injectable()
export class ApprovalEngine {
  private readonly definitions = new Map<string, ApprovalDefinition>();

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  register(type: string, definition: ApprovalDefinition): void {
    this.definitions.set(type, definition);
  }

  async create(context: SchoolContext, input: CreateApprovalInput) {
    if (!this.definitions.has(input.type)) {
      throw new BadRequestException(`Unknown approval type ${input.type}`);
    }
    if (input.tier === 4 && !input.documentFileId) {
      throw new BadRequestException('A supporting document is required for this change');
    }
    const pending = await this.database.approvalRequest.findFirst({
      where: {
        schoolId: context.schoolId,
        type: input.type,
        entityId: input.entityId,
        status: 'PENDING',
      },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException('A pending request already exists for this record');
    }
    const requiredRoles =
      input.tier === 4 ? [ROLE.SCHOOL_ADMIN, ROLE.PRINCIPAL] : [LEADER_SLOT];
    const request = await this.database.$transaction(async (transaction) => {
      const created = await transaction.approvalRequest.create({
        data: {
          schoolId: context.schoolId,
          requesterId: context.userId,
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId,
          reason: input.reason,
          payload: input.payload as Prisma.InputJsonValue | undefined,
          tier: input.tier,
          requiredRoles,
          documentFileId: input.documentFileId,
        },
      });
      if (input.tier === 4 && this.canFill(context, ROLE.SCHOOL_ADMIN)) {
        await transaction.approvalDecision.create({
          data: {
            requestId: created.id,
            approverId: context.userId,
            role: ROLE.SCHOOL_ADMIN,
            decision: 'APPROVED',
            note: 'Raised by School Admin',
          },
        });
      }
      await this.audit.record(
        context,
        {
          action: 'approval.requested',
          entityType: input.entityType,
          entityId: input.entityId,
          newValue: input.payload,
          reason: input.reason,
          approvalRequestId: created.id,
        },
        transaction,
      );
      return created;
    });
    await this.notify.toRoles(context.schoolId, [ROLE.SCHOOL_ADMIN, ROLE.PRINCIPAL], {
      type: 'approval.requested',
      title: 'Approval needed',
      body: `${context.displayName} requested: ${input.type} (${input.reason})`,
      data: { approvalRequestId: request.id },
    });
    return request;
  }

  async approve(context: SchoolContext, requestId: string, note?: string) {
    const request = await this.pending(context, requestId);
    const decided = await this.database.approvalDecision.findMany({
      where: { requestId },
      select: { role: true, approverId: true },
    });
    if (decided.some((decision) => decision.approverId === context.userId)) {
      throw new ConflictException('You have already decided on this request');
    }
    const open = request.requiredRoles.filter(
      (role) => !decided.some((decision) => decision.role === role),
    );
    const slot = open.find((role) => this.canFill(context, role));
    if (!slot) {
      throw new ForbiddenException('Your role cannot approve this request');
    }
    const complete = open.length === 1;
    const definition = this.definitions.get(request.type);
    return this.database.$transaction(async (transaction) => {
      await transaction.approvalDecision.create({
        data: { requestId, approverId: context.userId, role: slot, decision: 'APPROVED', note },
      });
      if (!complete) {
        return transaction.approvalRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: { decisions: true },
        });
      }
      const updated = await transaction.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', resolvedAt: new Date() },
        include: { decisions: true },
      });
      if (definition) {
        await definition.onApproved(transaction, updated, context);
      }
      await this.audit.record(
        context,
        {
          action: 'approval.approved',
          entityType: request.entityType,
          entityId: request.entityId,
          newValue: request.payload,
          reason: note,
          approvalRequestId: request.id,
        },
        transaction,
      );
      return updated;
    });
  }

  async reject(context: SchoolContext, requestId: string, note?: string) {
    const request = await this.pending(context, requestId);
    const slot = request.requiredRoles.find((role) => this.canFill(context, role));
    if (!slot) {
      throw new ForbiddenException('Your role cannot reject this request');
    }
    const definition = this.definitions.get(request.type);
    const updated = await this.database.$transaction(async (transaction) => {
      await transaction.approvalDecision.create({
        data: { requestId, approverId: context.userId, role: slot, decision: 'REJECTED', note },
      });
      const result = await transaction.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', resolvedAt: new Date() },
        include: { decisions: true },
      });
      if (definition?.onRejected) {
        await definition.onRejected(transaction, result, context);
      }
      await this.audit.record(
        context,
        {
          action: 'approval.rejected',
          entityType: request.entityType,
          entityId: request.entityId,
          reason: note,
          approvalRequestId: request.id,
        },
        transaction,
      );
      return result;
    });
    await this.notify.toUsers([request.requesterId], {
      type: 'approval.rejected',
      title: 'Request rejected',
      body: note ? `Your ${request.type} request was rejected: ${note}` : `Your ${request.type} request was rejected`,
      schoolId: request.schoolId,
      data: { approvalRequestId: request.id },
    });
    return updated;
  }

  async cancel(context: SchoolContext, requestId: string) {
    const request = await this.pending(context, requestId);
    if (request.requesterId !== context.userId && !context.isLeader) {
      throw new ForbiddenException('Only the requester can cancel this request');
    }
    const definition = this.definitions.get(request.type);
    return this.database.$transaction(async (transaction) => {
      const result = await transaction.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', resolvedAt: new Date() },
      });
      if (definition?.onRejected) {
        await definition.onRejected(transaction, result, context);
      }
      await this.audit.record(
        context,
        {
          action: 'approval.cancelled',
          entityType: request.entityType,
          entityId: request.entityId,
          approvalRequestId: request.id,
        },
        transaction,
      );
      return result;
    });
  }

  private canFill(context: AccessContext, role: string): boolean {
    if (role === LEADER_SLOT) {
      return context.isSchoolAdmin || context.isPrincipal || context.isSuperAdmin;
    }
    if (role === ROLE.SCHOOL_ADMIN) {
      return context.isSchoolAdmin || context.isSuperAdmin;
    }
    return context.roles.includes(role);
  }

  private async pending(context: SchoolContext, requestId: string) {
    const request = await this.database.approvalRequest.findFirst({
      where: { id: requestId, schoolId: context.schoolId },
    });
    if (!request) {
      throw new NotFoundException('Approval request not found');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException(`Approval request is already ${request.status.toLowerCase()}`);
    }
    return request;
  }
}
