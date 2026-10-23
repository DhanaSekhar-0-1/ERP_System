import { ApprovalStatus } from '@prisma/client';
import { IsEnum, IsIn, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination';

export class CreateApprovalRequestDto {
  @IsString()
  type!: string;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsString()
  @MinLength(3)
  reason!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsIn([3, 4])
  tier!: 3 | 4;

  @IsOptional()
  @IsUUID()
  documentFileId?: string;
}

export class DecisionDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class ApprovalQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}
