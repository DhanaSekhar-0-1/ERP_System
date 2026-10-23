import { BoardingType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRouteDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateStopDto {
  @IsUUID()
  routeId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence!: number;

  @IsOptional()
  @IsString()
  pickupTime?: string;

  @IsOptional()
  @IsString()
  dropTime?: string;
}

export class UpdateStopDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence?: number;

  @IsOptional()
  @IsString()
  pickupTime?: string;

  @IsOptional()
  @IsString()
  dropTime?: string;
}

export class CreateBusDto {
  @IsString()
  @MinLength(1)
  registrationNo!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity!: number;

  @IsOptional()
  @IsUUID()
  routeId?: string;
}

export class UpdateBusDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateDriverDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  @IsString()
  @MinLength(3)
  licenseNo!: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsUUID()
  busId?: string;
}

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUUID()
  busId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateAllocationDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  routeId!: string;

  @IsUUID()
  stopId!: string;
}

export class UpdateAllocationDto {
  @IsOptional()
  @IsUUID()
  stopId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BoardingEventDto {
  /** Either the student id or the NFC card id read on the bus. */
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsString()
  nfcId?: string;

  @IsOptional()
  @IsUUID()
  busId?: string;

  @IsEnum(BoardingType)
  type!: BoardingType;
}

export class BoardingQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsUUID()
  busId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
