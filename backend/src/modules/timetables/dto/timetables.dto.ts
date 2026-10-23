import { SubstituteStatus } from '@prisma/client';
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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateTimetableDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  sectionId!: string;
}

export class SubjectPeriodsDto {
  @IsUUID()
  subjectId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  periodsPerWeek!: number;
}

export class GenerateDraftDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  sectionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodsPerDay!: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  days?: number[];

  /** Weekly periods per subject; defaults to an even split across assigned subjects. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubjectPeriodsDto)
  subjects?: SubjectPeriodsDto[];
}

export class CreateSlotDto {
  @IsUUID()
  timetableId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodNo!: number;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  staffId!: string;

  @IsOptional()
  @IsString()
  room?: string;
}

export class UpdateSlotDto {
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsString()
  room?: string;
}

export class SlotQueryDto {
  @IsOptional()
  @IsUUID()
  timetableId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

export class CreateSubstituteRequestDto {
  @IsUUID()
  slotId!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AssignSubstituteDto {
  @IsUUID()
  staffId!: string;
}

export class SubstituteQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(SubstituteStatus)
  status?: SubstituteStatus;
}

export class BulkSlotsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSlotDto)
  slots!: CreateSlotDto[];
}
