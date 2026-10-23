import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Complaint, ComplaintStatus, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotifyService } from '../../common/notify/notify.service';
import { ROLE } from '../../common/access/roles';
import {
  AssignComplaintDto,
  ComplaintQueryDto,
  CreateComplaintDto,
  CreateFeedbackDto,
  UpdateComplaintDto,
  UpdateFeedbackDto,
} from './dto/complaints.dto';

const SLA_DAYS = 7;
const REPEAT_ALERT_THRESHOLD = 3;

/**
 * Complaints are routed to School Admin and Principal only. The named teacher never sees the
 * submission or the submitter; complaint access is separate from student and parent data.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  // ---------- Feedback ----------

  async createFeedback(authUser: SupabaseUser, input: CreateFeedbackDto) {
    const context = await this.access.schoolContext(authUser);
    if (input.targetStaffId) await this.assertStaff(context, input.targetStaffId);
    const feedback = await this.database.feedback.create({
      data: {
        schoolId: context.schoolId,
        submittedById: context.userId,
        category: input.category.trim(),
        message: input.message.trim(),
        isConfidential: input.isConfidential ?? false,
        targetStaffId: input.targetStaffId ?? null,
      },
    });
    await this.notify.toRoles(context.schoolId, [ROLE.SCHOOL_ADMIN, ROLE.PRINCIPAL], {
      type: 'feedback.received',
      title: 'New feedback',
      body: `${input.category}: ${input.message.slice(0, 80)}`,
      data: { feedbackId: feedback.id },
    });
    return feedback;
  }

  async findFeedback(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    const items = await this.database.feedback.findMany({
      where: {
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { submittedById: context.userId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return items;
  }

  async findFeedbackOne(authUser: SupabaseUser, feedbackId: string) {
    const context = await this.access.schoolContext(authUser);
    const feedback = await this.database.feedback.findFirst({
      where: {
        id: feedbackId,
        schoolId: context.schoolId,
        ...(context.isLeader ? {} : { submittedById: context.userId }),
      },
    });
    if (!feedback) throw new NotFoundException('Feedback not found');
    return feedback;
  }

  async updateFeedback(authUser: SupabaseUser, feedbackId: string, input: UpdateFeedbackDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const feedback = await this.findFeedbackOne(authUser, feedbackId);
    const updated = await this.database.feedback.update({
      where: { id: feedback.id },
      data: { status: input.status, response: input.response?.trim() },
    });
    if (input.response) {
      await this.notify.toUsers([feedback.submittedById], {
        type: 'feedback.responded',
        title: 'Response to your feedback',
        body: input.response.slice(0, 160),
        schoolId: context.schoolId,
        data: { feedbackId },
      });
    }
    return updated;
  }

  // ---------- Complaints ----------

  async create(authUser: SupabaseUser, input: CreateComplaintDto) {
    const context = await this.access.schoolContext(authUser);
    if (input.aboutStaffId) await this.assertStaff(context, input.aboutStaffId);
    if (input.studentId) await this.access.assertStudentAccess(context, input.studentId);
    if (input.evidenceFileIds?.length) {
      const files = await this.database.fileAsset.count({
        where: {
          id: { in: input.evidenceFileIds },
          schoolId: context.schoolId,
          uploadedById: context.userId,
          deletedAt: null,
        },
      });
      if (files !== input.evidenceFileIds.length) {
        throw new BadRequestException('Evidence files must be uploaded by you first');
      }
    }
    const anonymous = input.isAnonymous ?? false;
    const complaint = await this.database.$transaction(async (transaction) => {
      const created = await transaction.complaint.create({
        data: {
          schoolId: context.schoolId,
          submittedById: anonymous ? null : context.userId,
          isAnonymous: anonymous,
          category: input.category.trim(),
          subject: input.subject.trim(),
          description: input.description.trim(),
          aboutStaffId: input.aboutStaffId ?? null,
          studentId: input.studentId ?? null,
          evidenceFileIds: input.evidenceFileIds ?? [],
          slaDueAt: new Date(Date.now() + SLA_DAYS * 86_400_000),
          actions: { create: { action: 'SUBMITTED', actorId: anonymous ? null : context.userId } },
        },
      });
      return created;
    });
    await this.notify.toRoles(context.schoolId, [ROLE.SCHOOL_ADMIN, ROLE.PRINCIPAL], {
      type: 'complaint.submitted',
      title: anonymous ? 'New anonymous complaint' : 'New complaint',
      body: `${input.category}: ${input.subject}`,
      data: { complaintId: complaint.id },
    });
    if (input.aboutStaffId) await this.checkRepeated(context.schoolId, input.aboutStaffId);
    return this.present(context, complaint);
  }

  async findMany(authUser: SupabaseUser, query: ComplaintQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const managing = this.access.hasPermission(context, 'complaints:manage');
    if (managing) await this.escalateOverdue(context.schoolId);
    const complaints = await this.database.complaint.findMany({
      where: {
        schoolId: context.schoolId,
        ...(managing ? {} : { submittedById: context.userId }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.aboutStaffId && managing ? { aboutStaffId: query.aboutStaffId } : {}),
      },
      orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }],
      take: 500,
    });
    return complaints.map((complaint) => this.present(context, complaint));
  }

  async findOne(authUser: SupabaseUser, complaintId: string) {
    const context = await this.access.schoolContext(authUser);
    const complaint = await this.visible(context, complaintId);
    return this.present(context, complaint);
  }

  async update(authUser: SupabaseUser, complaintId: string, input: UpdateComplaintDto) {
    const context = await this.manager(authUser);
    const complaint = await this.visible(context, complaintId);
    return this.database.complaint.update({
      where: { id: complaint.id },
      data: { category: input.category?.trim(), subject: input.subject?.trim() },
    });
  }

  async assign(authUser: SupabaseUser, complaintId: string, input: AssignComplaintDto) {
    const context = await this.manager(authUser);
    const complaint = await this.visible(context, complaintId);
    const assignee = await this.database.user.findFirst({
      where: {
        id: input.assignedToId,
        schoolId: context.schoolId,
        status: 'ACTIVE',
        roles: { some: { role: { name: { in: [ROLE.SCHOOL_ADMIN, ROLE.PRINCIPAL] } } } },
      },
    });
    if (!assignee) throw new BadRequestException('Complaints can be assigned only to a School Admin or Principal');
    if (complaint.aboutStaffId) {
      const named = await this.database.staffProfile.findUnique({ where: { id: complaint.aboutStaffId } });
      if (named?.userId === assignee.id) {
        throw new BadRequestException('A complaint cannot be assigned to the person it is about');
      }
    }
    return this.transition(context, complaint, 'ASSIGNED', 'ASSIGNED', undefined, { assignedToId: assignee.id });
  }

  async startInvestigation(authUser: SupabaseUser, complaintId: string) {
    const context = await this.manager(authUser);
    const complaint = await this.visible(context, complaintId);
    return this.transition(context, complaint, 'INVESTIGATING', 'INVESTIGATION_STARTED');
  }

  async addAction(authUser: SupabaseUser, complaintId: string, note: string) {
    const context = await this.manager(authUser);
    const complaint = await this.visible(context, complaintId);
    if (complaint.status === 'RESOLVED') throw new ConflictException('Reopen the complaint before adding actions');
    await this.database.complaintAction.create({
      data: { complaintId: complaint.id, actorId: context.userId, action: 'NOTE', note: note.trim() },
    });
    return this.history(authUser, complaintId);
  }

  async resolve(authUser: SupabaseUser, complaintId: string, resolution: string) {
    const context = await this.manager(authUser);
    const complaint = await this.visible(context, complaintId);
    const resolved = await this.transition(context, complaint, 'RESOLVED', 'RESOLVED', resolution, {
      resolution: resolution.trim(),
    });
    if (complaint.submittedById) {
      await this.notify.toUsers([complaint.submittedById], {
        type: 'complaint.resolved',
        title: 'Complaint resolved',
        body: `${complaint.subject}: ${resolution.slice(0, 120)}`,
        schoolId: context.schoolId,
        data: { complaintId },
      });
    }
    return resolved;
  }

  async reopen(authUser: SupabaseUser, complaintId: string, reason: string) {
    const context = await this.access.schoolContext(authUser);
    const complaint = await this.visible(context, complaintId);
    if (complaint.status !== 'RESOLVED') throw new ConflictException('Only resolved complaints can be reopened');
    return this.transition(context, complaint, 'REOPENED', 'REOPENED', reason, {
      slaDueAt: new Date(Date.now() + SLA_DAYS * 86_400_000),
    });
  }

  async escalate(authUser: SupabaseUser, complaintId: string, reason: string) {
    const context = await this.manager(authUser);
    const complaint = await this.visible(context, complaintId);
    const escalated = await this.transition(context, complaint, 'ESCALATED', 'ESCALATED', reason, {
      escalatedAt: new Date(),
    });
    await this.notify.toRoles(context.schoolId, [ROLE.PRINCIPAL], {
      type: 'complaint.escalated',
      title: 'Complaint escalated',
      body: complaint.subject,
      data: { complaintId },
    });
    return escalated;
  }

  async history(authUser: SupabaseUser, complaintId: string) {
    const context = await this.access.schoolContext(authUser);
    const complaint = await this.visible(context, complaintId);
    const actions = await this.database.complaintAction.findMany({
      where: { complaintId: complaint.id },
      orderBy: { createdAt: 'asc' },
    });
    const managing = this.access.hasPermission(context, 'complaints:manage');
    return actions.map((action) => ({
      ...action,
      actorId: managing ? action.actorId : null,
      note: managing || action.action === 'RESOLVED' ? action.note : null,
    }));
  }

  // ---------- Helpers ----------

  private async transition(
    context: SchoolContext,
    complaint: Complaint,
    status: ComplaintStatus,
    action: string,
    note?: string,
    extra: Prisma.ComplaintUpdateInput = {},
  ) {
    if (complaint.status === 'RESOLVED' && status !== 'REOPENED') {
      throw new ConflictException('This complaint is resolved; reopen it first');
    }
    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.complaint.update({
        where: { id: complaint.id },
        data: { ...extra, status },
      });
      await transaction.complaintAction.create({
        data: { complaintId: complaint.id, actorId: context.userId, action, note: note?.trim() },
      });
      await this.audit.record(
        context,
        {
          action: `complaint.${action.toLowerCase()}`,
          entityType: 'complaint',
          entityId: complaint.id,
          oldValue: { status: complaint.status },
          newValue: { status },
          reason: note,
        },
        transaction,
      );
      return updated;
    });
  }

  /** Unresolved complaints past their SLA move to the Principal's queue automatically. */
  private async escalateOverdue(schoolId: string) {
    const overdue = await this.database.complaint.findMany({
      where: {
        schoolId,
        status: { in: ['SUBMITTED', 'ASSIGNED', 'INVESTIGATING', 'REOPENED'] },
        slaDueAt: { lt: new Date() },
      },
    });
    for (const complaint of overdue) {
      await this.database.$transaction([
        this.database.complaint.update({
          where: { id: complaint.id },
          data: { status: 'ESCALATED', escalatedAt: new Date() },
        }),
        this.database.complaintAction.create({
          data: { complaintId: complaint.id, action: 'AUTO_ESCALATED', note: `SLA of ${SLA_DAYS} days passed` },
        }),
      ]);
      await this.notify.toRoles(schoolId, [ROLE.PRINCIPAL], {
        type: 'complaint.escalated',
        title: 'Complaint past SLA',
        body: complaint.subject,
        data: { complaintId: complaint.id },
      });
    }
  }

  /** Repeated complaints about one teacher alert the Principal only; nothing is broadcast. */
  private async checkRepeated(schoolId: string, staffId: string) {
    const count = await this.database.complaint.count({ where: { schoolId, aboutStaffId: staffId } });
    if (count >= REPEAT_ALERT_THRESHOLD) {
      await this.notify.toRoles(schoolId, [ROLE.PRINCIPAL], {
        type: 'complaint.repeated',
        title: 'Repeated complaints',
        body: `${count} complaints have been raised about the same staff member.`,
        data: { aboutStaffId: staffId, count },
      });
    }
  }

  /** Submitter identity is visible only to complaint managers, and never for anonymous complaints. */
  private present(context: SchoolContext, complaint: Complaint) {
    const managing = this.access.hasPermission(context, 'complaints:manage');
    return {
      ...complaint,
      submittedById: managing && !complaint.isAnonymous ? complaint.submittedById : undefined,
      aboutStaffId: managing ? complaint.aboutStaffId : undefined,
      evidenceFileIds: managing ? complaint.evidenceFileIds : undefined,
    };
  }

  private async visible(context: SchoolContext, complaintId: string) {
    const managing = this.access.hasPermission(context, 'complaints:manage');
    const complaint = await this.database.complaint.findFirst({
      where: {
        id: complaintId,
        schoolId: context.schoolId,
        ...(managing ? {} : { submittedById: context.userId }),
      },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return complaint;
  }

  private async manager(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!this.access.hasPermission(context, 'complaints:manage')) {
      throw new ForbiddenException('Complaint management access is required');
    }
    return context;
  }

  private async assertStaff(context: SchoolContext, staffId: string) {
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
  }
}
