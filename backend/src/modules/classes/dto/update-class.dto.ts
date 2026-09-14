import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
