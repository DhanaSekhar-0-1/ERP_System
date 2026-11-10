import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Gender } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Registers a teacher with a login (MVP1 form, docs/mvp-plan.md). The app makes the Teacher ID
 * (T26A05), which is also the login ID, and a random first password that must be changed at
 * first login. "Designation" is replaced by the subjects the teacher can teach.
 */
export class CreateStaffDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName!: string;

  /** 10-digit mobile number. */
  @IsString()
  phone!: string;

  @IsDateString()
  joiningDate!: string;

  /** One or more subject names from the school's subject list; the first is the main one. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  teachingSubjects!: string[];

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  /** Optional. When given, the teacher can also sign in with it. */
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string;

  /** Optional until cards arrive. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  nfcId?: string;
}
