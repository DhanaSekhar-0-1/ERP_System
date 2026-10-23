import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class OfflineAttendanceItemDto {
  @IsUUID()
  enrollmentId!: string;

  @IsDateString()
  attendanceDate!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** When the device captured the entry; used to detect server-side changes made later. */
  @IsDateString()
  capturedAt!: string;
}

export class OfflineMarkItemDto {
  @IsUUID()
  assessmentId!: string;

  @IsUUID()
  studentId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marksObtained?: number;

  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @IsDateString()
  capturedAt!: string;
}

export class SyncAttendanceDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OfflineAttendanceItemDto)
  items!: OfflineAttendanceItemDto[];
}

export class SyncMarksDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OfflineMarkItemDto)
  items!: OfflineMarkItemDto[];
}

export class SyncBatchDto {
  @IsIn(['attendance', 'mark-drafts'])
  type!: 'attendance' | 'mark-drafts';

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  items!: Record<string, unknown>[];
}

export class ResolveConflictDto {
  @IsIn(['KEEP_SERVER', 'APPLY_CLIENT'])
  resolution!: 'KEEP_SERVER' | 'APPLY_CLIENT';

  @IsOptional()
  @IsString()
  note?: string;
}
