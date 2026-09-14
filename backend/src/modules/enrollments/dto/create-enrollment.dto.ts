import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateEnrollmentDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  studentId!: string;

  @IsUUID()
  classId!: string;

  @IsUUID()
  sectionId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  rollNumber?: string;
}
