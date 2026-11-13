import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StaffAttendanceStatus } from '@prisma/client';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Where the phone says it is. Only the distance from school is stored. */
export class LocationDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** The phone's own estimate of how far off the reading may be, in metres. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracy!: number;
}

export class StaffAttendanceSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  /** How far from the school location a check-in is accepted. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(2000)
  radiusMeters?: number;

  /** School-local time after which a check-in counts as late, e.g. 09:15. */
  @IsOptional()
  @Matches(HH_MM, { message: 'lateAfter must be a time like 09:15' })
  lateAfter?: string;
}

export class StaffAttendanceQueryDto {
  /** School-local date, YYYY-MM-DD. Defaults to today at the school. */
  @IsOptional()
  @IsDateString()
  date?: string;
}

/** The School Admin marks or changes a teacher's day, with a reason. */
export class StaffAttendanceCorrectionDto {
  @IsDateString()
  date!: string;

  @IsEnum(StaffAttendanceStatus)
  status!: StaffAttendanceStatus;

  @IsOptional()
  @Matches(HH_MM, { message: 'checkInTime must be a time like 08:55' })
  checkInTime?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'checkOutTime must be a time like 16:30' })
  checkOutTime?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
