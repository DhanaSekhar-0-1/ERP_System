import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateStaffDto {
  @IsUUID()
  authUserId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsString()
  @MinLength(1)
  employeeNo!: string;

  @IsString()
  @MinLength(1)
  nfcId!: string;
}
