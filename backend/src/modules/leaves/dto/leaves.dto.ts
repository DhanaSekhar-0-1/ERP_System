import { LeaveStatus, StaffLeaveType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateStudentLeaveDto {
  @IsUUID()
  studentId!: string;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class UpdateLeaveDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;
}

export class CreateStaffLeaveDto {
  @IsEnum(StaffLeaveType)
  leaveType!: StaffLeaveType;

  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class LeaveDecisionDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class LeaveQueryDto {
  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;
}

export class EntitlementDto {
  @IsEnum(StaffLeaveType)
  leaveType!: StaffLeaveType;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  days!: number;
}

export class UpdateEntitlementsDto {
  @IsUUID()
  academicYearId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EntitlementDto)
  entitlements!: EntitlementDto[];
}
