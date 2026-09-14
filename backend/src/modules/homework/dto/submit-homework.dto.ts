import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitHomeworkDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  attachmentUrl?: string;
}
