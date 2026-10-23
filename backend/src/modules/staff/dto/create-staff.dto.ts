import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateStaffDto {
  /** Existing Supabase Auth user; omit and pass a password to create the login here. */
  @IsOptional()
  @IsUUID()
  authUserId?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsString()
  @MinLength(1)
  employeeNo!: string;

  @IsString()
  @MinLength(1)
  nfcId!: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
