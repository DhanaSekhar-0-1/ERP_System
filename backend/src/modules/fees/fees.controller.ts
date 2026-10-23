import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import {
  ApplyDiscountDto,
  AssignStudentFeesDto,
  CreateFeeStructureDto,
  CreateOrderDto,
  FeeDecisionDto,
  FeeReportQueryDto,
  PaymentQueryDto,
  RecordPaymentDto,
  RefundRequestDto,
  StudentFeeQueryDto,
  SubmitForApprovalDto,
  UpdateFeeStructureDto,
  UpdateStudentFeeDto,
} from './dto/fees.dto';
import { FeesService } from './fees.service';

@Controller('fee-structures')
export class FeeStructuresController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @RequirePermissions('fees:read')
  findMany(
    @CurrentUser() user: SupabaseUser,
    @Query('academicYearId', new ParseUUIDPipe({ optional: true })) academicYearId?: string,
  ) {
    return this.fees.findStructures(user, academicYearId);
  }

  @Post()
  @RequirePermissions('fees:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateFeeStructureDto) {
    return this.fees.createStructure(user, input);
  }

  @Get(':feeStructureId')
  @RequirePermissions('fees:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
  ) {
    return this.fees.findStructure(user, feeStructureId);
  }

  @Patch(':feeStructureId')
  @RequirePermissions('fees:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
    @Body() input: UpdateFeeStructureDto,
  ) {
    return this.fees.updateStructure(user, feeStructureId, input);
  }

  @Post(':feeStructureId/submit-approval')
  @RequirePermissions('fees:manage')
  submit(
    @CurrentUser() user: SupabaseUser,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
    @Body() input: SubmitForApprovalDto,
  ) {
    return this.fees.submitStructure(user, feeStructureId, input.reason);
  }

  @Post(':feeStructureId/approve')
  @RequirePermissions('approvals:manage')
  approve(
    @CurrentUser() user: SupabaseUser,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
    @Body() input: FeeDecisionDto,
  ) {
    return this.fees.decideStructure(user, feeStructureId, 'approve', input.note);
  }

  @Post(':feeStructureId/reject')
  @RequirePermissions('approvals:manage')
  reject(
    @CurrentUser() user: SupabaseUser,
    @Param('feeStructureId', ParseUUIDPipe) feeStructureId: string,
    @Body() input: FeeDecisionDto,
  ) {
    return this.fees.decideStructure(user, feeStructureId, 'reject', input.note);
  }
}

@Controller('student-fees')
export class StudentFeesController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @RequirePermissions('fees:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: StudentFeeQueryDto) {
    return this.fees.findStudentFees(user, query);
  }

  @Post()
  @RequirePermissions('fees:manage')
  assign(@CurrentUser() user: SupabaseUser, @Body() input: AssignStudentFeesDto) {
    return this.fees.assign(user, input);
  }

  @Get(':studentFeeId')
  @RequirePermissions('fees:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('studentFeeId', ParseUUIDPipe) studentFeeId: string,
  ) {
    return this.fees.findStudentFee(user, studentFeeId);
  }

  @Patch(':studentFeeId')
  @RequirePermissions('fees:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('studentFeeId', ParseUUIDPipe) studentFeeId: string,
    @Body() input: UpdateStudentFeeDto,
  ) {
    return this.fees.updateStudentFee(user, studentFeeId, input);
  }

  @Post(':studentFeeId/apply-discount')
  @RequirePermissions('fees:manage')
  discount(
    @CurrentUser() user: SupabaseUser,
    @Param('studentFeeId', ParseUUIDPipe) studentFeeId: string,
    @Body() input: ApplyDiscountDto,
  ) {
    return this.fees.applyDiscount(user, studentFeeId, input);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @RequirePermissions('fees:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: PaymentQueryDto) {
    return this.fees.findPayments(user, query);
  }

  @Post()
  @RequirePermissions('fees:manage')
  record(@CurrentUser() user: SupabaseUser, @Body() input: RecordPaymentDto) {
    return this.fees.recordPayment(user, input);
  }

  @Post('orders')
  @RequirePermissions('fees:pay')
  order(@CurrentUser() user: SupabaseUser, @Body() input: CreateOrderDto) {
    return this.fees.createOrder(user, input);
  }

  @Get(':paymentId')
  @RequirePermissions('fees:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.fees.findPayment(user, paymentId);
  }

  @Post(':paymentId/verify')
  @RequirePermissions('fees:manage')
  verify(
    @CurrentUser() user: SupabaseUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.fees.verifyPayment(user, paymentId);
  }

  @Post(':paymentId/refund-request')
  @RequirePermissions('fees:manage')
  refundRequest(
    @CurrentUser() user: SupabaseUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() input: RefundRequestDto,
  ) {
    return this.fees.refundRequest(user, paymentId, input.reason);
  }

  @Post(':paymentId/refund')
  @RequirePermissions('approvals:manage')
  refund(
    @CurrentUser() user: SupabaseUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() input: FeeDecisionDto,
  ) {
    return this.fees.refund(user, paymentId, input.note);
  }

  @Get(':paymentId/receipt')
  @RequirePermissions('fees:read')
  receipt(
    @CurrentUser() user: SupabaseUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.fees.receipt(user, paymentId);
  }
}

@Controller()
export class FeeViewsController {
  constructor(private readonly fees: FeesService) {}

  @Get('students/:studentId/fee-summary')
  @RequirePermissions('fees:read')
  summary(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.fees.studentSummary(user, studentId);
  }

  @Get('fees/overdue')
  @RequirePermissions('fees:manage')
  overdue(@CurrentUser() user: SupabaseUser) {
    return this.fees.overdue(user);
  }

  @Get('fees/reports')
  @RequirePermissions('fees:manage')
  reports(@CurrentUser() user: SupabaseUser, @Query() query: FeeReportQueryDto) {
    return this.fees.reports(user, query);
  }
}
