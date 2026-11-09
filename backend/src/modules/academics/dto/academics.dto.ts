import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateSectionSubjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  /** Defaults to letters from the name, such as "COMPUTER" for "Computer Science". */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

export class UpdateSectionSubjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  /** Switching a subject off removes its teacher assignments. */
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class SetTeacherDto {
  /** Leave empty to remove the teacher. */
  @IsOptional()
  @IsUUID()
  staffId?: string | null;
}

export class DefaultSubjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

export class DefaultSubjectsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DefaultSubjectDto)
  subjects!: DefaultSubjectDto[];
}
