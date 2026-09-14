import { IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsUUID()
  targetClassId?: string;

  @IsOptional()
  @IsUUID()
  targetSectionId?: string;

  @IsOptional()
  @IsString()
  targetRole?: string;

  @IsOptional()
  @IsObject()
  targetMetadata?: Record<string, unknown>;
}
