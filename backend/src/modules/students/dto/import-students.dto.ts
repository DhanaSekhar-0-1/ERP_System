import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsObject, IsOptional, IsUUID } from 'class-validator';

/**
 * Rows from the school's Excel sheet, one object per row, keyed by the template's column
 * names: admission_no, admission_date, admission_type, first_name, family_name, gender,
 * date_of_birth, class, section, parent_name, parent_mobile, aadhaar_or_enrolment_no,
 * nfc_card_id, and optionally roll_number, parent_relation, other_parent_name,
 * other_parent_mobile, email, blood_group, mother_tongue, address, pin_code, previous_school,
 * last_class_passed, previous_percentage, previous_tc_number.
 */
export class ImportStudentsDto {
  /** True: check every row and report problems without saving anything. */
  @IsBoolean()
  dryRun!: boolean;

  /** Defaults to the school's active academic year. */
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  rows!: Record<string, unknown>[];
}
