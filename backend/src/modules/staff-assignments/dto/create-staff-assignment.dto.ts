import { IsString, MinLength } from 'class-validator';

export class CreateStaffAssignmentDto {
  @IsString()
  @MinLength(1)
  staffId!: string;

  @IsString()
  @MinLength(1)
  academicYearId!: string;

  @IsString()
  @MinLength(1)
  classId!: string;

  @IsString()
  @MinLength(1)
  subjectId!: string;
}
