import { IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  admissionNo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nfcId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  /** Required when changing name, date of birth or admission number (Tier 4). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;

  /** Supporting document (ID proof) for Tier 4 changes. */
  @IsOptional()
  @IsUUID()
  documentFileId?: string;
}
