import { PaymentMethod, PaymentStatus, StudentFeeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination';

export class FeeItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class CreateFeeStructureDto {
  @IsUUID()
  academicYearId!: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  items!: FeeItemDto[];
}

export class UpdateFeeStructureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  items?: FeeItemDto[];
}

export class SubmitForApprovalDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class FeeDecisionDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class AssignStudentFeesDto {
  @IsUUID()
  feeStructureId!: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  studentIds?: string[];

  /** Assigns to every active enrollment in the structure's class when studentIds is omitted. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

export class UpdateStudentFeeDto {
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(StudentFeeStatus)
  status?: StudentFeeStatus;
}

export class ApplyDiscountDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class RecordPaymentDto {
  @IsUUID()
  studentFeeId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class CreateOrderDto {
  @IsUUID()
  studentFeeId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;
}

export class RefundRequestDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class StudentFeeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  feeStructureId?: string;

  @IsOptional()
  @IsEnum(StudentFeeStatus)
  status?: StudentFeeStatus;
}

export class PaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  studentFeeId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class FeeReportQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
