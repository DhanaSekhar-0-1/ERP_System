import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AdmissionType, Gender } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Registers a student, puts them in a section with the next roll number, records the parent,
 * and creates a login (admission number + generated first password, changed at first login).
 * Business rules (Aadhaar, mobile, duplicates, previous school) are checked in the service so
 * the Excel import applies exactly the same ones.
 */
export class CreateStudentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  admissionNo!: string;

  @IsDateString()
  admissionDate!: string;

  @IsEnum(AdmissionType)
  admissionType!: AdmissionType;

  @IsUUID()
  sectionId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10)
  rollNumber?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  familyName!: string;

  @IsEnum(Gender)
  gender!: Gender;

  @IsDateString()
  dateOfBirth!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  parentName!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  parentRelation?: string;

  @IsString()
  parentMobile!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  otherParentName?: string;

  @IsOptional()
  @IsString()
  otherParentMobile?: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  email?: string;

  /** Required unless the school has turned the Aadhaar requirement off, or a slip is given. */
  @IsOptional()
  @IsString()
  aadhaarNumber?: string;

  /** When Aadhaar has been applied for but not issued yet. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  aadhaarEnrolmentNo?: string;

  /** Required unless the school has turned the NFC card requirement off. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  nfcId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5)
  bloodGroup?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  motherTongue?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10)
  pinCode?: string;

  /** Needed when admissionType is NEW_TO_SCHOOL. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  previousSchool?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  lastClassPassed?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  previousPercentage?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  previousTcNumber?: string;
}
