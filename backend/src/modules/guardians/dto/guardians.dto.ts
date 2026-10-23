import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { SearchQueryDto } from '../../../common/http/pagination';

export class CreateGuardianDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  relation?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  relation?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class LinkStudentDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary = false;
}

export class ListGuardiansDto extends SearchQueryDto {}

export class CreateGuardianAccountDto {
  @IsEmail()
  email!: string;

  /** Omit to send an invitation email instead of setting a password. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateChildContactDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
