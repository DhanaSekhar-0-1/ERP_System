import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { ApprovalQueryDto, CreateApprovalRequestDto, DecisionDto } from './dto/approvals.dto';
import { ApprovalsService } from './approvals.service';

@Controller('approval-requests')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @RequirePermissions('approvals:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: ApprovalQueryDto) {
    return this.approvals.findMany(user, query);
  }

  @Post()
  @RequirePermissions('approvals:request')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateApprovalRequestDto) {
    return this.approvals.create(user, input);
  }

  @Get(':approvalRequestId')
  @RequirePermissions('approvals:read')
  findOne(
    @CurrentUser() user: SupabaseUser,
    @Param('approvalRequestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.approvals.findOne(user, requestId);
  }

  @Post(':approvalRequestId/approve')
  @RequirePermissions('approvals:manage')
  approve(
    @CurrentUser() user: SupabaseUser,
    @Param('approvalRequestId', ParseUUIDPipe) requestId: string,
    @Body() input: DecisionDto,
  ) {
    return this.approvals.approve(user, requestId, input.note);
  }

  @Post(':approvalRequestId/reject')
  @RequirePermissions('approvals:manage')
  reject(
    @CurrentUser() user: SupabaseUser,
    @Param('approvalRequestId', ParseUUIDPipe) requestId: string,
    @Body() input: DecisionDto,
  ) {
    return this.approvals.reject(user, requestId, input.note);
  }

  @Post(':approvalRequestId/cancel')
  @RequirePermissions('approvals:read')
  cancel(
    @CurrentUser() user: SupabaseUser,
    @Param('approvalRequestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.approvals.cancel(user, requestId);
  }

  @Get(':approvalRequestId/history')
  @RequirePermissions('approvals:read')
  history(
    @CurrentUser() user: SupabaseUser,
    @Param('approvalRequestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.approvals.history(user, requestId);
  }
}
