import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class TransferEnrollmentDto {
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsUUID()
  sectionId!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class PromoteEnrollmentDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  classId!: string;

  @IsUUID()
  sectionId!: string;

  @IsOptional()
  @IsString()
  rollNumber?: string;
}

export class WithdrawEnrollmentDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class StudentEnrollmentDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  classId!: string;

  @IsUUID()
  sectionId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  rollNumber?: string;
}
