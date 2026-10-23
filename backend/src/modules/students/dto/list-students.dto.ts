import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { SearchQueryDto } from '../../../common/http/pagination';

export class ListStudentsDto extends SearchQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;
}
