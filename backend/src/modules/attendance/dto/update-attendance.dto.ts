import { AttendanceStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAttendanceDto {
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Required for every change to a saved record (Tier 2). */
  @IsString()
  @MinLength(3)
  reason!: string;
}
