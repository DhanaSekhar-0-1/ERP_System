import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
