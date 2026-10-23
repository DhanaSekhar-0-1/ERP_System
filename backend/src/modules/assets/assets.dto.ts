import { AssetStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAssetDto {
  @IsString()
  @MinLength(1)
  assetTag!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number;
}

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  condition?: string;
}

export class AssignAssetDto {
  @IsUUID()
  staffId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class TransferAssetDto {
  @IsString()
  @MinLength(1)
  location!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class MaintenanceDto {
  @IsString()
  @MinLength(3)
  note!: string;

  /** IN_MAINTENANCE to start, ACTIVE when the work is finished. */
  @IsEnum(AssetStatus)
  status!: AssetStatus;
}

export class DisposeAssetDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class AssetQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @IsOptional()
  @IsString()
  location?: string;
}
