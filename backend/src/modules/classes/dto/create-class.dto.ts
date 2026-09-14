import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateClassDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  academicYearId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
