import { IsEmail, IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  recoveryToken!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class SendOtpDto {
  @IsEmail()
  email!: string;
}

export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 10)
  token!: string;

  @IsOptional()
  @IsIn(['email', 'signup'])
  type?: 'email' | 'signup';
}

export class MfaSetupDto {
  @IsOptional()
  @IsString()
  friendlyName?: string;
}

export class MfaVerifyDto {
  @IsString()
  factorId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaDisableDto {
  @IsString()
  factorId!: string;
}
