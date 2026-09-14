import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateSectionDto {
  @IsUUID()
  classId!: string;

  @IsUUID()
  academicYearId!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
