import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  employeeNo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nfcId?: string;
}
