import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService } from '../../common/access/access.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { pageArgs, paged } from '../../common/http/pagination';
import { ApprovalQueryDto, CreateApprovalRequestDto } from './dto/approvals.dto';

const INCLUDE = {
  requester: { select: { id: true, displayName: true, email: true } },
  decisions: {
    orderBy: { createdAt: 'asc' as const },
    include: { approver: { select: { id: true, displayName: true } } },
  },
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly engine: ApprovalEngine,
  ) {}

  async findMany(authUser: SupabaseUser, query: ApprovalQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const where: Prisma.ApprovalRequestWhereInput = {
      schoolId: context.schoolId,
      ...(context.isLeader ? {} : { requesterId: context.userId }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.approvalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: INCLUDE,
        ...pageArgs(query),
      }),
      this.database.approvalRequest.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async findOne(authUser: SupabaseUser, requestId: string) {
    const context = await this.access.schoolContext(authUser);
    const request = await this.database.approvalRequest.findFirst({
      where: {
        id: requestId,
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { requesterId: context.userId }),
      },
      include: INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Approval request not found');
    }
    return request;
  }

  async create(authUser: SupabaseUser, input: CreateApprovalRequestDto) {
    const context = await this.access.schoolContext(authUser);
    return this.engine.create(context, input);
  }

  async approve(authUser: SupabaseUser, requestId: string, note?: string) {
    const context = await this.access.schoolContext(authUser);
    return this.engine.approve(context, requestId, note);
  }

  async reject(authUser: SupabaseUser, requestId: string, note?: string) {
    const context = await this.access.schoolContext(authUser);
    return this.engine.reject(context, requestId, note);
  }

  async cancel(authUser: SupabaseUser, requestId: string) {
    const context = await this.access.schoolContext(authUser);
    return this.engine.cancel(context, requestId);
  }

  async history(authUser: SupabaseUser, requestId: string) {
    const request = await this.findOne(authUser, requestId);
    const events = await this.database.auditLog.findMany({
      where: { approvalRequestId: request.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, displayName: true } } },
    });
    return { request, events };
  }
}
