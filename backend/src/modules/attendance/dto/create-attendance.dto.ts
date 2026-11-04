import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination';

export class CreateAttendanceDto {
  @IsUUID()
  enrollmentId!: string;

  @IsDateString()
  attendanceDate!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class BulkAttendanceItemDto {
  @IsUUID()
  enrollmentId!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class BulkAttendanceDto {
  @IsDateString()
  attendanceDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkAttendanceItemDto)
  records!: BulkAttendanceItemDto[];

  /** Required when bulk marking changes records already saved. */
  @IsOptional()
  @IsString()
  reason?: string;
}

export class NfcScanDto {
  @IsString()
  @MinLength(1)
  nfcId!: string;

  @IsDateString()
  attendanceDate!: string;

  /** When set, a card belonging to a student of another section is refused. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

export class MySectionsQueryDto {
  @IsDateString()
  attendanceDate!: string;
}

export class CorrectionRequestDto {
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class AttendanceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsDateString()
  attendanceDate?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  enrollmentId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
}

export class AttendanceSummaryQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
