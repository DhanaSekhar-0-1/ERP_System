import {
  Body,
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
import {
  CertificateDecisionDto,
  CertificateQueryDto,
  CreateCertificateDto,
  SubmitCertificateDto,
} from './dto/certificates.dto';
import { CertificatesService } from './certificates.service';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @RequirePermissions('certificates:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: CertificateQueryDto) {
    return this.certificates.findMany(user, query);
  }

  @Post()
  @RequirePermissions('certificates:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateCertificateDto) {
    return this.certificates.create(user, input);
  }

  @Get(':certificateId')
  @RequirePermissions('certificates:read')
  findOne(@CurrentUser() user: SupabaseUser, @Param('certificateId', ParseUUIDPipe) id: string) {
    return this.certificates.findOne(user, id);
  }

  @Post(':certificateId/submit-approval')
  @RequirePermissions('certificates:manage')
  submit(
    @CurrentUser() user: SupabaseUser,
    @Param('certificateId', ParseUUIDPipe) id: string,
    @Body() input: SubmitCertificateDto,
  ) {
    return this.certificates.submit(user, id, input);
  }

  @Post(':certificateId/approve')
  @RequirePermissions('approvals:manage')
  approve(
    @CurrentUser() user: SupabaseUser,
    @Param('certificateId', ParseUUIDPipe) id: string,
    @Body() input: CertificateDecisionDto,
  ) {
    return this.certificates.decide(user, id, 'approve', input.note);
  }

  @Post(':certificateId/reject')
  @RequirePermissions('approvals:manage')
  reject(
    @CurrentUser() user: SupabaseUser,
    @Param('certificateId', ParseUUIDPipe) id: string,
    @Body() input: CertificateDecisionDto,
  ) {
    return this.certificates.decide(user, id, 'reject', input.note);
  }

  @Post(':certificateId/generate')
  @RequirePermissions('certificates:manage')
  generate(@CurrentUser() user: SupabaseUser, @Param('certificateId', ParseUUIDPipe) id: string) {
    return this.certificates.generate(user, id);
  }

  @Get(':certificateId/download')
  @RequirePermissions('certificates:read')
  @RawResponse()
  @Header('Content-Type', 'text/html; charset=utf-8')
  download(@CurrentUser() user: SupabaseUser, @Param('certificateId', ParseUUIDPipe) id: string) {
    return this.certificates.downloadHtml(user, id);
  }
}
