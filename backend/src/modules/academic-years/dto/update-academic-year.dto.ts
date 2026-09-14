import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAcademicYearDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  name?: string;

  @IsOptional()
  @IsDateString()
  startsOn?: string;

  @IsOptional()
  @IsDateString()
  endsOn?: string;
}
