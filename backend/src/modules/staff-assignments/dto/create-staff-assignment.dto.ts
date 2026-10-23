import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateStaffAssignmentDto {
  @IsUUID()
  staffId!: string;

  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  classId!: string;

  /** Omit to cover every section of the class. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsBoolean()
  isClassTeacher?: boolean;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

export class StaffAssignmentInputDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsBoolean()
  isClassTeacher?: boolean;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

/** Reassigns an existing assignment to another teacher or section. */
export class ReassignStaffAssignmentDto {
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsBoolean()
  isClassTeacher?: boolean;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}
