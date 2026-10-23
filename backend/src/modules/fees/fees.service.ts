import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Payment, PaymentMethod, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { NotifyService } from '../../common/notify/notify.service';
import { pageArgs, paged } from '../../common/http/pagination';
import {
  ApplyDiscountDto,
  AssignStudentFeesDto,
  CreateFeeStructureDto,
  CreateOrderDto,
  FeeReportQueryDto,
  PaymentQueryDto,
  RecordPaymentDto,
  StudentFeeQueryDto,
  UpdateFeeStructureDto,
  UpdateStudentFeeDto,
} from './dto/fees.dto';

const STRUCTURE_APPROVAL = 'fees.structure';
const DISCOUNT = 'fees.discount';
const REFUND = 'fees.refund';

/** Offline methods that need a clearance step before they count as paid. */
const NEEDS_VERIFICATION: PaymentMethod[] = ['CHEQUE', 'BANK_TRANSFER'];

@Injectable()
export class FeesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalEngine,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(STRUCTURE_APPROVAL, {
      onApproved: async (transaction, request, approver) => {
        await transaction.feeStructure.update({
          where: { id: request.entityId },
          data: { status: 'APPROVED', approvedById: approver.userId, approvedAt: new Date() },
        });
      },
      onRejected: async (transaction, request) => {
        await transaction.feeStructure.update({
          where: { id: request.entityId },
          data: { status: 'REJECTED' },
        });
      },
    });
    this.approvals.register(DISCOUNT, {
      onApproved: async (transaction, request, approver) => {
        const { amount } = request.payload as { amount: number };
        const fee = await transaction.studentFee.findUniqueOrThrow({ where: { id: request.entityId } });
        await transaction.studentFee.update({
          where: { id: fee.id },
          data: { discountAmount: Number(fee.discountAmount) + amount },
        });
        await this.recompute(transaction, fee.id);
        await this.audit.record(
          approver,
          {
            action: 'fees.discount-applied',
            entityType: 'student-fee',
            entityId: fee.id,
            oldValue: { discountAmount: fee.discountAmount },
            newValue: { discountAmount: Number(fee.discountAmount) + amount },
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
    });
    this.approvals.register(REFUND, {
      onApproved: async (transaction, request, approver) => {
        const payment = await transaction.payment.update({
          where: { id: request.entityId },
          data: { status: 'REFUNDED', refundReason: request.reason },
        });
        await this.recompute(transaction, payment.studentFeeId);
        await this.audit.record(
          approver,
          {
            action: 'payment.refunded',
            entityType: 'payment',
            entityId: payment.id,
            reason: request.reason,
            approvalRequestId: request.id,
            schoolId: request.schoolId,
          },
          transaction,
        );
      },
      onRejected: async (transaction, request) => {
        await transaction.payment.update({
          where: { id: request.entityId },
          data: { status: 'VERIFIED' },
        });
      },
    });
  }

  // ---------- Fee structures ----------

  async createStructure(authUser: SupabaseUser, input: CreateFeeStructureDto) {
    const context = await this.finance(authUser);
    const year = await this.database.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: context.schoolId },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    if (input.classId) {
      const schoolClass = await this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId: context.schoolId, academicYearId: input.academicYearId },
      });
      if (!schoolClass) throw new NotFoundException('Class not found in this academic year');
    }
    const structure = await this.database.feeStructure.create({
      data: {
        schoolId: context.schoolId,
        academicYearId: input.academicYearId,
        classId: input.classId ?? null,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        items: {
          create: input.items.map((item) => ({
            name: item.name.trim(),
            amount: item.amount,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
          })),
        },
      },
      include: { items: true },
    });
    await this.audit.record(context, {
      action: 'fee-structure.created',
      entityType: 'fee-structure',
      entityId: structure.id,
      newValue: input,
    });
    return structure;
  }

  async findStructures(authUser: SupabaseUser, academicYearId?: string) {
    const context = await this.access.schoolContext(authUser);
    return this.database.feeStructure.findMany({
      where: {
        schoolId: context.schoolId,
        ...(academicYearId ? { academicYearId } : {}),
        ...(this.isFinance(context) ? {} : { status: 'APPROVED' }),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true, class: { select: { id: true, name: true } } },
    });
  }

  async findStructure(authUser: SupabaseUser, feeStructureId: string) {
    const context = await this.access.schoolContext(authUser);
    const structure = await this.database.feeStructure.findFirst({
      where: { id: feeStructureId, schoolId: context.schoolId },
      include: { items: true, class: { select: { id: true, name: true } } },
    });
    if (!structure) throw new NotFoundException('Fee structure not found');
    return structure;
  }

  /** The base structure is editable only before approval; later changes need a new structure. */
  async updateStructure(authUser: SupabaseUser, feeStructureId: string, input: UpdateFeeStructureDto) {
    const context = await this.finance(authUser);
    const structure = await this.findStructure(authUser, feeStructureId);
    if (!['DRAFT', 'REJECTED'].includes(structure.status)) {
      throw new ConflictException('Only draft or rejected fee structures can be edited');
    }
    const updated = await this.database.$transaction(async (transaction) => {
      if (input.items) {
        await transaction.feeItem.deleteMany({ where: { feeStructureId } });
        await transaction.feeItem.createMany({
          data: input.items.map((item) => ({
            feeStructureId,
            name: item.name.trim(),
            amount: item.amount,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
          })),
        });
      }
      return transaction.feeStructure.update({
        where: { id: feeStructureId },
        data: {
          name: input.name?.trim(),
          description: input.description === undefined ? undefined : input.description.trim() || null,
          status: 'DRAFT',
        },
        include: { items: true },
      });
    });
    await this.audit.record(context, {
      action: 'fee-structure.updated',
      entityType: 'fee-structure',
      entityId: feeStructureId,
      oldValue: { items: structure.items },
      newValue: input,
    });
    return updated;
  }

  async submitStructure(authUser: SupabaseUser, feeStructureId: string, reason: string) {
    const context = await this.finance(authUser);
    const structure = await this.findStructure(authUser, feeStructureId);
    if (!['DRAFT', 'REJECTED'].includes(structure.status)) {
      throw new ConflictException(`Fee structure is already ${structure.status.toLowerCase()}`);
    }
    await this.database.feeStructure.update({
      where: { id: feeStructureId },
      data: { status: 'PENDING_APPROVAL' },
    });
    return this.approvals.create(context, {
      type: STRUCTURE_APPROVAL,
      entityType: 'fee-structure',
      entityId: feeStructureId,
      reason,
      payload: { total: structure.items.reduce((sum, item) => sum + Number(item.amount), 0) },
      tier: 3,
    });
  }

  async decideStructure(
    authUser: SupabaseUser,
    feeStructureId: string,
    decision: 'approve' | 'reject',
    note?: string,
  ) {
    const context = await this.access.schoolContext(authUser);
    const request = await this.database.approvalRequest.findFirst({
      where: {
        schoolId: context.schoolId,
        type: STRUCTURE_APPROVAL,
        entityId: feeStructureId,
        status: 'PENDING',
      },
    });
    if (!request) throw new NotFoundException('No pending approval for this fee structure');
    await (decision === 'approve'
      ? this.approvals.approve(context, request.id, note)
      : this.approvals.reject(context, request.id, note));
    return this.findStructure(authUser, feeStructureId);
  }

  // ---------- Student fees ----------

  async assign(authUser: SupabaseUser, input: AssignStudentFeesDto) {
    const context = await this.finance(authUser);
    const structure = await this.findStructure(authUser, input.feeStructureId);
    if (structure.status !== 'APPROVED') {
      throw new ConflictException('Only approved fee structures can be assigned');
    }
    let studentIds = input.studentIds;
    if (!studentIds?.length) {
      const enrollments = await this.database.enrollment.findMany({
        where: {
          schoolId: context.schoolId,
          academicYearId: structure.academicYearId,
          status: 'ACTIVE',
          ...(structure.classId ? { classId: structure.classId } : {}),
          ...(input.sectionId ? { sectionId: input.sectionId } : {}),
        },
        select: { studentId: true },
      });
      studentIds = enrollments.map((enrollment) => enrollment.studentId);
    }
    const students = await this.database.student.findMany({
      where: { id: { in: studentIds }, schoolId: context.schoolId, isArchived: false },
      select: { id: true },
    });
    const total = structure.items.reduce((sum, item) => sum + Number(item.amount), 0);
    const dueDates = structure.items
      .map((item) => item.dueDate)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime());
    const created = await this.database.studentFee.createMany({
      data: students.map((student) => ({
        schoolId: context.schoolId,
        studentId: student.id,
        feeStructureId: structure.id,
        totalAmount: total,
        dueDate: dueDates[0] ?? null,
      })),
      skipDuplicates: true,
    });
    await this.audit.record(context, {
      action: 'student-fees.assigned',
      entityType: 'fee-structure',
      entityId: structure.id,
      newValue: { students: students.length, created: created.count, total },
    });
    return { feeStructureId: structure.id, assigned: created.count, skipped: students.length - created.count };
  }

  async findStudentFees(authUser: SupabaseUser, query: StudentFeeQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const where: Prisma.StudentFeeWhereInput = {
      AND: [
        await this.feeVisibility(context),
        {
          ...(query.studentId ? { studentId: query.studentId } : {}),
          ...(query.feeStructureId ? { feeStructureId: query.feeStructureId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
      ],
    };
    const [items, total] = await this.database.$transaction([
      this.database.studentFee.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        include: this.studentFeeInclude(),
        ...pageArgs(query),
      }),
      this.database.studentFee.count({ where }),
    ]);
    return paged(items.map((fee) => this.withBalance(fee)), total, query);
  }

  async findStudentFee(authUser: SupabaseUser, studentFeeId: string) {
    const context = await this.access.schoolContext(authUser);
    const fee = await this.database.studentFee.findFirst({
      where: { AND: [{ id: studentFeeId }, await this.feeVisibility(context)] },
      include: { ...this.studentFeeInclude(), payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!fee) throw new NotFoundException('Student fee not found');
    return this.withBalance(fee);
  }

  async updateStudentFee(authUser: SupabaseUser, studentFeeId: string, input: UpdateStudentFeeDto) {
    const context = await this.finance(authUser);
    const fee = await this.scopedFee(context, studentFeeId);
    const updated = await this.database.studentFee.update({
      where: { id: fee.id },
      data: {
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        status: input.status === 'CANCELLED' ? 'CANCELLED' : undefined,
      },
    });
    await this.audit.record(context, {
      action: 'student-fee.updated',
      entityType: 'student-fee',
      entityId: fee.id,
      oldValue: { dueDate: fee.dueDate, status: fee.status },
      newValue: input,
    });
    return updated;
  }

  /** Accountants request discounts; a School Admin or Principal applies them (Tier 3). */
  async applyDiscount(authUser: SupabaseUser, studentFeeId: string, input: ApplyDiscountDto) {
    const context = await this.finance(authUser);
    const fee = await this.scopedFee(context, studentFeeId);
    const balance = Number(fee.totalAmount) - Number(fee.discountAmount) - Number(fee.paidAmount);
    if (input.amount > balance) {
      throw new BadRequestException(`Discount cannot exceed the balance of ${balance.toFixed(2)}`);
    }
    const request = await this.approvals.create(context, {
      type: DISCOUNT,
      entityType: 'student-fee',
      entityId: fee.id,
      reason: input.reason,
      payload: { amount: input.amount },
      tier: 3,
    });
    if (context.isSchoolAdmin || context.isPrincipal) {
      await this.approvals.approve(context, request.id, 'Applied by approver');
      return { applied: true, studentFee: await this.findStudentFee(authUser, fee.id) };
    }
    return { applied: false, approvalRequest: request };
  }

  async studentSummary(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    const fees = await this.database.studentFee.findMany({
      where: { studentId, schoolId: context.schoolId, status: { not: 'CANCELLED' } },
      include: {
        feeStructure: { select: { id: true, name: true, academicYearId: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { dueDate: 'asc' },
    });
    const rows = fees.map((fee) => this.withBalance(fee));
    const today = new Date();
    return {
      studentId,
      totalDue: rows.reduce((sum, row) => sum + Number(row.totalAmount), 0),
      totalDiscount: rows.reduce((sum, row) => sum + Number(row.discountAmount), 0),
      totalPaid: rows.reduce((sum, row) => sum + Number(row.paidAmount), 0),
      balance: rows.reduce((sum, row) => sum + row.balance, 0),
      overdue: rows.filter((row) => row.balance > 0 && row.dueDate && row.dueDate < today).length,
      fees: rows,
    };
  }

  async overdue(authUser: SupabaseUser) {
    const context = await this.finance(authUser);
    const fees = await this.database.studentFee.findMany({
      where: {
        schoolId: context.schoolId,
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: new Date() },
      },
      orderBy: { dueDate: 'asc' },
      include: this.studentFeeInclude(),
      take: 1000,
    });
    return fees.map((fee) => ({
      ...this.withBalance(fee),
      daysOverdue: Math.floor((Date.now() - (fee.dueDate as Date).getTime()) / 86_400_000),
    }));
  }

  async reports(authUser: SupabaseUser, query: FeeReportQueryDto) {
    const context = await this.finance(authUser);
    const paidAt = { gte: new Date(query.from), lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) };
    const [byMethod, outstanding, byStatus] = await Promise.all([
      this.database.payment.groupBy({
        by: ['method'],
        where: { schoolId: context.schoolId, status: 'VERIFIED', paidAt },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.database.studentFee.aggregate({
        where: { schoolId: context.schoolId, status: { in: ['PENDING', 'PARTIAL'] } },
        _sum: { totalAmount: true, discountAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.database.studentFee.groupBy({
        by: ['status'],
        where: { schoolId: context.schoolId },
        _count: { _all: true },
      }),
    ]);
    const collected = byMethod.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);
    const outstandingAmount =
      Number(outstanding._sum.totalAmount ?? 0) -
      Number(outstanding._sum.discountAmount ?? 0) -
      Number(outstanding._sum.paidAmount ?? 0);
    return {
      from: query.from,
      to: query.to,
      collected,
      collectionsByMethod: byMethod.map((row) => ({
        method: row.method,
        amount: Number(row._sum.amount ?? 0),
        payments: row._count._all,
      })),
      outstanding: { amount: outstandingAmount, accounts: outstanding._count._all },
      feesByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    };
  }

  // ---------- Payments ----------

  async recordPayment(authUser: SupabaseUser, input: RecordPaymentDto) {
    const context = await this.finance(authUser);
    const fee = await this.scopedFee(context, input.studentFeeId);
    this.assertPayable(fee, input.amount);
    const verified = !NEEDS_VERIFICATION.includes(input.method);
    const payment = await this.database.$transaction(async (transaction) => {
      const created = await transaction.payment.create({
        data: {
          schoolId: context.schoolId,
          studentFeeId: fee.id,
          amount: input.amount,
          method: input.method,
          reference: input.reference?.trim() || null,
          status: verified ? 'VERIFIED' : 'PENDING',
          paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
          recordedById: context.userId,
          verifiedById: verified ? context.userId : null,
          receiptNo: verified ? this.receiptNumber() : null,
        },
      });
      await this.recompute(transaction, fee.id);
      await this.audit.record(
        context,
        {
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: created.id,
          newValue: { amount: input.amount, method: input.method, status: created.status },
        },
        transaction,
      );
      return created;
    });
    if (verified) {
      await this.notifyPaid(fee.studentId, payment);
    }
    return payment;
  }

  async findPayments(authUser: SupabaseUser, query: PaymentQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const paidAt: Prisma.DateTimeNullableFilter = {};
    if (query.from) paidAt.gte = new Date(query.from);
    if (query.to) paidAt.lte = new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`);
    const where: Prisma.PaymentWhereInput = {
      schoolId: context.schoolId,
      studentFee: await this.feeVisibility(context),
      ...(query.studentFeeId ? { studentFeeId: query.studentFeeId } : {}),
      ...(query.studentId ? { studentFee: { studentId: query.studentId } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(Object.keys(paidAt).length ? { paidAt } : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          studentFee: {
            select: {
              id: true,
              student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
              feeStructure: { select: { id: true, name: true } },
            },
          },
        },
        ...pageArgs(query),
      }),
      this.database.payment.count({ where }),
    ]);
    return paged(items, total, query);
  }

  async findPayment(authUser: SupabaseUser, paymentId: string) {
    const context = await this.access.schoolContext(authUser);
    const payment = await this.database.payment.findFirst({
      where: { id: paymentId, schoolId: context.schoolId, studentFee: await this.feeVisibility(context) },
      include: { studentFee: { include: this.studentFeeInclude() } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async verifyPayment(authUser: SupabaseUser, paymentId: string) {
    const context = await this.finance(authUser);
    const payment = await this.findPayment(authUser, paymentId);
    if (payment.status !== 'PENDING') {
      throw new ConflictException(`Payment is already ${payment.status.toLowerCase()}`);
    }
    this.assertPayable(payment.studentFee, Number(payment.amount));
    const verified = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: 'VERIFIED',
          verifiedById: context.userId,
          receiptNo: this.receiptNumber(),
          paidAt: payment.paidAt ?? new Date(),
        },
      });
      await this.recompute(transaction, payment.studentFeeId);
      await this.audit.record(
        context,
        { action: 'payment.verified', entityType: 'payment', entityId: payment.id },
        transaction,
      );
      return updated;
    });
    await this.notifyPaid(payment.studentFee.studentId, verified);
    return verified;
  }

  async refundRequest(authUser: SupabaseUser, paymentId: string, reason: string) {
    const context = await this.finance(authUser);
    const payment = await this.findPayment(authUser, paymentId);
    if (payment.status !== 'VERIFIED') {
      throw new ConflictException('Only verified payments can be refunded');
    }
    await this.database.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUND_REQUESTED', refundReason: reason },
    });
    return this.approvals.create(context, {
      type: REFUND,
      entityType: 'payment',
      entityId: payment.id,
      reason,
      payload: { amount: Number(payment.amount) },
      tier: 3,
    });
  }

  /** Approves the pending refund request for this payment. */
  async refund(authUser: SupabaseUser, paymentId: string, note?: string) {
    const context = await this.access.schoolContext(authUser);
    const request = await this.database.approvalRequest.findFirst({
      where: { schoolId: context.schoolId, type: REFUND, entityId: paymentId, status: 'PENDING' },
    });
    if (!request) throw new NotFoundException('No pending refund request for this payment');
    await this.approvals.approve(context, request.id, note);
    return this.findPayment(authUser, paymentId);
  }

  async receipt(authUser: SupabaseUser, paymentId: string) {
    const payment = await this.findPayment(authUser, paymentId);
    if (!payment.receiptNo) {
      throw new ConflictException('A receipt is issued once the payment is verified');
    }
    const school = await this.database.school.findUniqueOrThrow({
      where: { id: payment.schoolId },
      include: { settings: true },
    });
    const fee = this.withBalance(payment.studentFee);
    return {
      receiptNo: payment.receiptNo,
      issuedAt: payment.paidAt,
      school: { name: school.name, code: school.code, address: school.settings?.address ?? null },
      student: payment.studentFee.student,
      feeStructure: payment.studentFee.feeStructure,
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.reference,
      status: payment.status,
      balanceAfterPayment: fee.balance,
    };
  }

  /**
   * Creates a gateway order for a parent or student. With RAZORPAY_KEY_ID and
   * RAZORPAY_KEY_SECRET set, the order is created at Razorpay; otherwise a local
   * order id is issued for development.
   */
  async createOrder(authUser: SupabaseUser, input: CreateOrderDto) {
    const context = await this.access.schoolContext(authUser);
    const fee = await this.findStudentFee(authUser, input.studentFeeId);
    this.assertPayable(fee, input.amount);
    const orderId = await this.gatewayOrder(input.amount, fee.id);
    const payment = await this.database.payment.create({
      data: {
        schoolId: context.schoolId,
        studentFeeId: fee.id,
        amount: input.amount,
        method: 'ONLINE',
        status: 'PENDING',
        gatewayOrderId: orderId,
        recordedById: context.userId,
      },
    });
    return {
      paymentId: payment.id,
      provider: 'razorpay',
      orderId,
      amount: input.amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID ?? null,
    };
  }

  /** Marks the gateway payment captured; shared by both webhook providers. Idempotent. */
  async captureGatewayPayment(orderId: string, gatewayPaymentId: string | undefined, success: boolean) {
    const payment = await this.database.payment.findUnique({
      where: { gatewayOrderId: orderId },
      include: { studentFee: true },
    });
    if (!payment) return { matched: false };
    if (payment.status !== 'PENDING') return { matched: true, alreadyProcessed: true };
    const updated = await this.database.$transaction(async (transaction) => {
      const result = await transaction.payment.update({
        where: { id: payment.id },
        data: success
          ? {
              status: 'VERIFIED',
              gatewayPaymentId: gatewayPaymentId ?? null,
              receiptNo: this.receiptNumber(),
              paidAt: new Date(),
            }
          : { status: 'FAILED', gatewayPaymentId: gatewayPaymentId ?? null },
      });
      await this.recompute(transaction, payment.studentFeeId);
      await this.audit.record(
        null,
        {
          action: success ? 'payment.captured' : 'payment.failed',
          entityType: 'payment',
          entityId: payment.id,
          schoolId: payment.schoolId,
          metadata: { orderId, gatewayPaymentId },
        },
        transaction,
      );
      return result;
    });
    if (success) await this.notifyPaid(payment.studentFee.studentId, updated);
    return { matched: true, status: updated.status };
  }

  // ---------- Helpers ----------

  private async gatewayOrder(amount: number, receipt: string): Promise<string> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return `order_dev_${randomBytes(8).toString('hex')}`;
    }
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt: receipt.slice(0, 40) }),
    });
    if (!response.ok) {
      throw new BadRequestException('Unable to create the payment order');
    }
    return ((await response.json()) as { id: string }).id;
  }

  private assertPayable(
    fee: { status: string; totalAmount: Prisma.Decimal; discountAmount: Prisma.Decimal; paidAmount: Prisma.Decimal },
    amount: number,
  ) {
    if (fee.status === 'CANCELLED') throw new ConflictException('This fee has been cancelled');
    const balance = Number(fee.totalAmount) - Number(fee.discountAmount) - Number(fee.paidAmount);
    if (amount > balance + 0.001) {
      throw new BadRequestException(`Amount exceeds the balance of ${balance.toFixed(2)}`);
    }
  }

  private async recompute(transaction: Prisma.TransactionClient, studentFeeId: string) {
    const fee = await transaction.studentFee.findUniqueOrThrow({ where: { id: studentFeeId } });
    const paid = await transaction.payment.aggregate({
      where: { studentFeeId, status: 'VERIFIED' },
      _sum: { amount: true },
    });
    const paidAmount = Number(paid._sum.amount ?? 0);
    const payable = Number(fee.totalAmount) - Number(fee.discountAmount);
    const status =
      fee.status === 'CANCELLED'
        ? 'CANCELLED'
        : paidAmount >= payable - 0.001
          ? 'PAID'
          : paidAmount > 0
            ? 'PARTIAL'
            : 'PENDING';
    await transaction.studentFee.update({ where: { id: studentFeeId }, data: { paidAmount, status } });
  }

  private receiptNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `RCPT-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private withBalance<T extends { totalAmount: Prisma.Decimal; discountAmount: Prisma.Decimal; paidAmount: Prisma.Decimal }>(
    fee: T,
  ) {
    return {
      ...fee,
      balance:
        Math.round(
          (Number(fee.totalAmount) - Number(fee.discountAmount) - Number(fee.paidAmount)) * 100,
        ) / 100,
    };
  }

  private studentFeeInclude() {
    return {
      student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
      feeStructure: { select: { id: true, name: true, academicYearId: true } },
    };
  }

  private async notifyPaid(studentId: string, payment: Payment) {
    await this.notify.toStudentFamily(studentId, {
      type: 'fees.paid',
      title: 'Payment received',
      body: `Received ${Number(payment.amount).toFixed(2)} (${payment.receiptNo ?? 'pending receipt'}).`,
      data: { paymentId: payment.id },
    });
  }

  private isFinance(context: SchoolContext) {
    return context.isAccountant || context.isLeader;
  }

  private async finance(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    if (!this.isFinance(context)) {
      throw new ForbiddenException('Accountant or School Admin access is required');
    }
    return context;
  }

  private async feeVisibility(context: SchoolContext): Promise<Prisma.StudentFeeWhereInput> {
    if (this.isFinance(context)) return { schoolId: context.schoolId };
    const scope = await this.access.studentScope(context);
    return { schoolId: context.schoolId, studentId: { in: scope.all ? [] : scope.ids } };
  }

  private async scopedFee(context: SchoolContext, studentFeeId: string) {
    const fee = await this.database.studentFee.findFirst({
      where: { id: studentFeeId, schoolId: context.schoolId },
    });
    if (!fee) throw new NotFoundException('Student fee not found');
    return fee;
  }
}
