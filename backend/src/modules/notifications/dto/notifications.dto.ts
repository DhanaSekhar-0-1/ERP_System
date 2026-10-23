import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination';

export class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  digest?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mutedTypes?: string[];
}

export class RegisterDeviceDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsIn(['android', 'ios', 'web'])
  platform!: string;
}

export class CreateTemplateDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsIn(['IN_APP', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP'])
  channel!: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @MinLength(1)
  body!: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;
}

export class TestNotificationDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;
}
