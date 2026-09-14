import { IsBoolean, IsUUID } from 'class-validator';

export class LinkStudentDto {
  @IsUUID()
  studentId!: string;

  @IsBoolean()
  isPrimary = false;
}
