import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateAcademicYearDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;
}
