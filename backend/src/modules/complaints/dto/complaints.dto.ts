import { ComplaintStatus, FeedbackStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @MinLength(2)
  category!: string;

  @IsString()
  @MinLength(3)
  message!: string;

  @IsOptional()
  @IsBoolean()
  isConfidential?: boolean;

  @IsOptional()
  @IsUUID()
  targetStaffId?: string;
}

export class UpdateFeedbackDto {
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @IsOptional()
  @IsString()
  response?: string;
}

export class CreateComplaintDto {
  @IsString()
  @MinLength(2)
  category!: string;

  @IsString()
  @MinLength(3)
  subject!: string;

  @IsString()
  @MinLength(10)
  description!: string;

  @IsOptional()
  @IsUUID()
  aboutStaffId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  evidenceFileIds?: string[];
}

export class UpdateComplaintDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  subject?: string;
}

export class AssignComplaintDto {
  @IsUUID()
  assignedToId!: string;
}

export class ComplaintNoteDto {
  @IsString()
  @MinLength(3)
  note!: string;
}

export class ComplaintQueryDto {
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @IsOptional()
  @IsUUID()
  aboutStaffId?: string;
}
