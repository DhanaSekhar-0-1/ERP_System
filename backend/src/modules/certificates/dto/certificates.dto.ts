import { CertificateStatus, CertificateType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCertificateDto {
  @IsUUID()
  studentId!: string;

  @IsEnum(CertificateType)
  type!: CertificateType;

  @IsOptional()
  @IsString()
  purpose?: string;

  /** Re-issue: the issued certificate this one replaces (a new version, never an overwrite). */
  @IsOptional()
  @IsUUID()
  supersedesId?: string;
}

export class SubmitCertificateDto {
  @IsString()
  @MinLength(3)
  reason!: string;

  /** Required for transfer certificates (Tier 4). */
  @IsOptional()
  @IsUUID()
  documentFileId?: string;
}

export class CertificateDecisionDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class CertificateQueryDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsEnum(CertificateStatus)
  status?: CertificateStatus;

  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;
}
