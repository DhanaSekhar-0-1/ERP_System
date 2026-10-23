import { OverrideEffect } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePermissionOverrideDto {
  @IsString()
  @MinLength(3)
  permissionCode!: string;

  @IsEnum(OverrideEffect)
  effect!: OverrideEffect;

  @IsOptional()
  @IsString()
  reason?: string;
}
