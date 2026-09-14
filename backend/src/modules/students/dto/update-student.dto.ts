import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

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
}
