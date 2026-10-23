import { LibraryIssueStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { SearchQueryDto } from '../../common/http/pagination';

export class CreateBookDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  copies!: number;
}

export class UpdateBookDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  copies?: number;
}

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

export class IssueBookDto {
  @IsUUID()
  bookId!: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsDateString()
  dueDate!: string;
}

export class ReturnBookDto {
  @IsUUID()
  issueId!: string;

  @IsOptional()
  @IsBoolean()
  lost?: boolean;
}

export class CreateFineDto {
  @IsUUID()
  issueId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class BookQueryDto extends SearchQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class IssueQueryDto {
  @IsOptional()
  @IsEnum(LibraryIssueStatus)
  status?: LibraryIssueStatus;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}
