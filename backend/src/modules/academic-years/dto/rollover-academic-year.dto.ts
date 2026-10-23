import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class RolloverAcademicYearDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;

  @IsOptional()
  @IsBoolean()
  copyAssignments?: boolean;

  /** Moves every active student to the class with the next sort order and the same section name. */
  @IsOptional()
  @IsBoolean()
  promoteStudents?: boolean;

  /** Students who repeat their current class in the new year. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  retainStudentIds?: string[];
}
