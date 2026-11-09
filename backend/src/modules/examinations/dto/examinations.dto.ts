import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ExamType } from '@prisma/client';

/** Exam types a School Admin, Principal or Super Admin can create. Slip tests have their own route. */
export const SCHOOL_EXAM_TYPES = Object.values(ExamType).filter((type) => type !== ExamType.SLIP_TEST);

export class CreateExaminationDto {
  @IsUUID()
  academicYearId!: string;

  @IsOptional()
  @IsIn(SCHOOL_EXAM_TYPES)
  type?: ExamType;

  /** Defaults to the type's name, such as "FA1" or "Q1 Quarterly". Required for OTHER. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @IsDateString()
  startsOn?: string;

  @IsOptional()
  @IsDateString()
  endsOn?: string;
}

export class UpdateExaminationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @IsDateString()
  startsOn?: string;

  @IsOptional()
  @IsDateString()
  endsOn?: string;
}

export class CreateAssessmentDto {
  @IsUUID()
  classId!: string;

  @IsUUID()
  subjectId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  maxMarks!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  passMarks?: number;

  @IsOptional()
  @IsDateString()
  examDate?: string;
}

/** A teacher's slip test: one exam with one assessment for a class, optionally one section. */
export class CreateSlipTestDto {
  /** Defaults to the active academic year. */
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsUUID()
  subjectId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  maxMarks!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  passMarks?: number;

  @IsOptional()
  @IsDateString()
  examDate?: string;
}

/** Adds every switched-on subject of every section in a class to an exam. */
export class AddClassSubjectsDto {
  @IsUUID()
  classId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  maxMarks!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  passMarks?: number;

  @IsOptional()
  @IsDateString()
  examDate?: string;
}

export class ExamNoteDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RereleaseRequestDto {
  @IsString()
  @MinLength(3)
  reason!: string;

  @IsUUID()
  documentFileId!: string;
}

export class MarkEntryDto {
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

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CreateMarkDto extends MarkEntryDto {
  @IsUUID()
  assessmentId!: string;
}

export class BulkMarksDto {
  @IsUUID()
  assessmentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  marks!: MarkEntryDto[];
}

export class UpdateMarkDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marksObtained?: number;

  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class SubmitMarksDto {
  @IsUUID()
  assessmentId!: string;
}

export class MarkCorrectionDto extends UpdateMarkDto {
  @IsString()
  @MinLength(3)
  reason!: string;

  /** Required once results are released (Tier 4). */
  @IsOptional()
  @IsUUID()
  documentFileId?: string;
}

export class MarksQueryDto {
  @IsOptional()
  @IsUUID()
  assessmentId?: string;

  @IsOptional()
  @IsUUID()
  examinationId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
