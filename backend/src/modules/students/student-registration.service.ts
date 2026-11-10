import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdmissionType, Gender, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ROLE } from '../../common/access/roles';
import {
  aadhaarHash,
  hasPiiKey,
  isValidAadhaar,
  maskAadhaar,
  normaliseAadhaar,
  protectAadhaar,
} from '../../common/identity/aadhaar';
import { normaliseMobile, studentFirstPassword } from '../../common/identity/first-password';
import { nameProblem, realDate } from '../../common/identity/text-rules';
import { CreateStudentDto } from './dto/create-student.dto';
import { ImportStudentsDto } from './dto/import-students.dto';

/** One student to register, after its section has been chosen (form) or looked up (Excel). */
type StudentInput = Omit<CreateStudentDto, 'sectionId'> & { sectionId?: string };

interface SectionInfo {
  id: string;
  classId: string;
  academicYearId: string;
  label: string;
}

/** A row that passed every check, ready to be saved. */
interface PreparedStudent {
  input: StudentInput;
  section: SectionInfo;
  parentMobile: string;
  otherParentMobile: string | null;
  aadhaar: string | null;
  nfcId: string | null;
}

/** Per-school switches, stored in school settings metadata under `registration`. */
interface RegistrationRules {
  requireAadhaar: boolean;
  requireNfcCard: boolean;
}

/** Names already used in this batch, so two rows in one Excel file cannot clash either. */
interface BatchSeen {
  admissionNos: Set<string>;
  aadhaarHashes: Set<string>;
  nfcIds: Set<string>;
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const ADMISSION_NO = /^[A-Za-z0-9][A-Za-z0-9/ .-]*$/;
const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_IMPORT_ROWS = 500;

/**
 * Registers students under the MVP1 rules (docs/mvp-plan.md): the school's admission number is
 * the login ID, the first password is made from the family name and the parent's mobile and
 * must be changed at first login, Aadhaar is stored encrypted, the student goes straight into
 * a section with the next roll number, and the parent is recorded as the primary guardian.
 * The single-student form and the Excel import run exactly the same checks.
 */
@Injectable()
export class StudentRegistrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Only the School Admin and Super Admin register students. */
  async registrationContext(authUser: Parameters<AccessService['schoolContext']>[0]) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can register students');
    return context;
  }

  async createOne(context: SchoolContext, input: CreateStudentDto) {
    const rules = await this.rules(context.schoolId);
    const section = await this.sectionById(context.schoolId, input.sectionId);
    const seen: BatchSeen = { admissionNos: new Set(), aadhaarHashes: new Set(), nfcIds: new Set() };
    const checked = await this.check(context, input, section, rules, seen);
    if ('errors' in checked) {
      if (checked.alreadyRegistered) {
        throw new ConflictException(checked.errors.join('; '));
      }
      throw new BadRequestException(checked.errors.join('; '));
    }
    return this.register(context, checked.prepared);
  }

  /**
   * Checks every row first. A dry run only reports. A real run saves nothing if any row has a
   * problem; otherwise it registers each row in turn. Rows whose admission number is already
   * registered are skipped, so the same file can be run again safely.
   */
  async importRows(context: SchoolContext, input: ImportStudentsDto) {
    if (input.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    }
    const rules = await this.rules(context.schoolId);
    const sections = await this.sectionsByName(context.schoolId, input.academicYearId);
    const seen: BatchSeen = { admissionNos: new Set(), aadhaarHashes: new Set(), nfcIds: new Set() };
    const ready: { row: number; prepared: PreparedStudent }[] = [];
    const problems: { row: number; admissionNo: string | null; errors: string[] }[] = [];
    const skipped: { row: number; admissionNo: string }[] = [];

    for (const [index, raw] of input.rows.entries()) {
      const row = index + 2; // Row 1 of the sheet is the header.
      const { student, errors: shapeErrors } = this.fromRow(raw);
      const className = this.text(raw.class);
      const sectionName = this.text(raw.section);
      const section = sections.get(this.sectionKey(className, sectionName));
      const errors = [...shapeErrors];
      if (!className || !sectionName) {
        errors.push('class and section are required');
      } else if (!section) {
        errors.push(`class ${className} section ${sectionName} does not exist in this academic year`);
      }
      const checked = await this.check(context, student, section ?? null, rules, seen);
      if ('errors' in checked) {
        if (checked.alreadyRegistered && !errors.length) {
          skipped.push({ row, admissionNo: student.admissionNo });
          continue;
        }
        errors.push(...checked.errors);
      }
      if (errors.length || !('prepared' in checked)) {
        problems.push({ row, admissionNo: student.admissionNo || null, errors: [...new Set(errors)] });
        continue;
      }
      ready.push({ row, prepared: checked.prepared });
    }

    const summary = {
      dryRun: input.dryRun,
      totalRows: input.rows.length,
      readyToImport: ready.length,
      alreadyRegistered: skipped,
      problems,
    };
    if (input.dryRun || problems.length) {
      return { ...summary, imported: 0, logins: [], failed: [] };
    }

    const logins: { row: number; admissionNo: string; name: string; section: string; firstPassword: string }[] = [];
    const failed: { row: number; admissionNo: string; error: string }[] = [];
    for (const { row, prepared } of ready) {
      try {
        const created = await this.register(context, prepared);
        logins.push({
          row,
          admissionNo: created.loginId,
          name: `${prepared.input.firstName} ${prepared.input.familyName}`,
          section: prepared.section.label,
          firstPassword: created.firstPassword,
        });
      } catch (error) {
        failed.push({
          row,
          admissionNo: prepared.input.admissionNo,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    await this.audit.record(context, {
      action: 'student.imported',
      entityType: 'school',
      entityId: context.schoolId,
      newValue: { imported: logins.length, skipped: skipped.length, failed: failed.length },
    });
    return { ...summary, imported: logins.length, logins, failed };
  }

  // ---------- checks ----------

  private async check(
    context: SchoolContext,
    input: StudentInput,
    section: SectionInfo | null,
    rules: RegistrationRules,
    seen: BatchSeen,
  ): Promise<{ prepared: PreparedStudent } | { errors: string[]; alreadyRegistered: boolean }> {
    const errors: string[] = this.formatErrors(input);
    let alreadyRegistered = false;

    const admissionNo = input.admissionNo?.trim() ?? '';
    if (!admissionNo) {
      errors.push('admission number is required');
    } else {
      const key = admissionNo.toLowerCase();
      if (seen.admissionNos.has(key)) {
        errors.push(`admission number ${admissionNo} appears twice in this file`);
      }
      seen.admissionNos.add(key);
      const existing = await this.database.student.findFirst({
        where: { schoolId: context.schoolId, admissionNo: { equals: admissionNo, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        alreadyRegistered = true;
        errors.push(`admission number ${admissionNo} is already registered`);
      }
    }

    const admissionDate = this.date(input.admissionDate);
    if (!admissionDate) errors.push('admission date is missing or not a date');
    else if (admissionDate.getTime() > Date.now()) errors.push('admission date is in the future');

    if (!Object.values(AdmissionType).includes(input.admissionType)) {
      errors.push('admission type must be NEW_TO_SCHOOL or EXISTING');
    }
    if (!section) {
      if (input.sectionId) errors.push('section not found in this school');
    }

    if (!Object.values(Gender).includes(input.gender)) errors.push('gender must be MALE, FEMALE or OTHER');

    const dob = this.date(input.dateOfBirth);
    if (!dob) {
      errors.push('date of birth is missing or not a date');
    } else {
      const age = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
      if (age < 2 || age > 25) errors.push('date of birth gives an age outside 2 to 25 years');
      if (admissionDate && dob >= admissionDate) errors.push('date of birth is after the admission date');
    }

    const parentMobile = input.parentMobile ? normaliseMobile(input.parentMobile) : null;
    if (!parentMobile) errors.push("parent's mobile must be a 10-digit mobile number");
    let otherParentMobile: string | null = null;
    if (input.otherParentMobile?.trim()) {
      otherParentMobile = normaliseMobile(input.otherParentMobile);
      if (!otherParentMobile) errors.push("other parent's mobile must be a 10-digit mobile number");
    }

    let aadhaar: string | null = null;
    if (input.aadhaarNumber?.trim()) {
      aadhaar = normaliseAadhaar(input.aadhaarNumber);
      if (!isValidAadhaar(aadhaar)) {
        errors.push('Aadhaar number is not valid (12 digits with a correct check digit)');
        aadhaar = null;
      } else if (!hasPiiKey()) {
        errors.push('Aadhaar cannot be stored: the server has no PII_ENCRYPTION_KEY');
        aadhaar = null;
      } else {
        const hash = aadhaarHash(aadhaar, context.schoolId);
        if (seen.aadhaarHashes.has(hash)) errors.push('this Aadhaar number appears twice in this file');
        seen.aadhaarHashes.add(hash);
        const taken = await this.database.student.findFirst({
          where: { schoolId: context.schoolId, aadhaarHash: hash },
          select: { admissionNo: true },
        });
        if (taken && !alreadyRegistered) {
          errors.push(`this Aadhaar number is already registered to admission number ${taken.admissionNo}`);
        }
      }
    } else if (input.aadhaarEnrolmentNo?.trim()) {
      // An Aadhaar enrolment slip number has at least 14 digits. A run of 10 to 13 digits is
      // almost always an Aadhaar number with a digit missing or extra, so it is not accepted.
      const slip = input.aadhaarEnrolmentNo.trim();
      const digits = slip.replace(/\D/g, '');
      if (/^[\d\s-]+$/.test(slip) && digits.length >= 10 && digits.length <= 13) {
        errors.push(`Aadhaar number has ${digits.length} digits; it needs exactly 12`);
      } else if (digits.length < 14) {
        errors.push('enrolment slip number must have at least 14 digits');
      }
    } else if (rules.requireAadhaar) {
      errors.push('Aadhaar number, or the enrolment slip number if it is not issued yet, is required');
    }

    let nfcId: string | null = null;
    if (input.nfcId?.trim()) {
      nfcId = input.nfcId.trim().toUpperCase();
      if (seen.nfcIds.has(nfcId)) errors.push(`card ${nfcId} appears twice in this file`);
      seen.nfcIds.add(nfcId);
      const [studentCard, staffCard] = await Promise.all([
        this.database.student.findUnique({ where: { nfcId }, select: { admissionNo: true } }),
        this.database.staffProfile.findUnique({ where: { nfcId }, select: { id: true } }),
      ]);
      if ((studentCard && !alreadyRegistered) || staffCard) {
        errors.push(`card ${nfcId} is already given to someone else`);
      }
    } else if (rules.requireNfcCard) {
      errors.push('NFC card ID is required');
    }

    if (input.admissionType === AdmissionType.NEW_TO_SCHOOL) {
      if (!input.previousSchool?.trim()) errors.push('previous school is required for a student new to the school');
      if (!input.lastClassPassed?.trim()) errors.push('last class passed is required for a student new to the school');
      if (input.previousPercentage === undefined || input.previousPercentage === null) {
        errors.push('percentage in the last class is required for a student new to the school');
      }
    }
    if (
      input.previousPercentage !== undefined &&
      input.previousPercentage !== null &&
      !(Number(input.previousPercentage) >= 0 && Number(input.previousPercentage) <= 100)
    ) {
      errors.push('percentage must be between 0 and 100');
    }
    if (input.pinCode?.trim() && !/^\d{6}$/.test(input.pinCode.trim())) errors.push('PIN code must be 6 digits');
    if (input.bloodGroup?.trim() && !BLOOD_GROUPS.includes(input.bloodGroup.trim().toUpperCase())) {
      errors.push(`blood group must be one of ${BLOOD_GROUPS.join(', ')}`);
    }
    if (section && input.rollNumber?.trim()) {
      const rollTaken = await this.database.enrollment.findFirst({
        where: { sectionId: section.id, academicYearId: section.academicYearId, rollNumber: input.rollNumber.trim() },
        select: { id: true },
      });
      if (rollTaken) errors.push(`roll number ${input.rollNumber.trim()} is already used in ${section.label}`);
    }

    if (errors.length || !section || !parentMobile) {
      return { errors, alreadyRegistered };
    }
    return { prepared: { input: { ...input, admissionNo }, section, parentMobile, otherParentMobile, aadhaar, nfcId } };
  }

  // ---------- saving ----------

  private async register(context: SchoolContext, prepared: PreparedStudent) {
    const { input, section } = prepared;
    const studentId = randomUUID();
    const firstName = input.firstName.trim();
    const familyName = input.familyName.trim();
    const displayName = `${firstName} ${familyName}`;
    const firstPassword = studentFirstPassword(familyName, prepared.parentMobile);
    const loginEmail = `${studentId}@students.erp.local`;
    const managedAuthUser = await this.supabaseAuth.createManagedUser({
      email: loginEmail,
      password: firstPassword,
      displayName,
    });

    try {
      const result = await this.database.$transaction(async (transaction) => {
        const studentRole = await transaction.role.findUnique({ where: { name: ROLE.STUDENT } });
        if (!studentRole) {
          throw new NotFoundException('Student role is missing; run the seed first');
        }
        const user = await transaction.user.create({
          data: {
            authUserId: managedAuthUser.id,
            email: loginEmail,
            displayName,
            phone: prepared.parentMobile,
            status: 'ACTIVE',
            mustChangePassword: true,
            organizationId: context.organizationId,
            schoolId: context.schoolId,
          },
        });
        await transaction.userRole.create({ data: { userId: user.id, roleId: studentRole.id } });
        const student = await transaction.student.create({
          data: {
            id: studentId,
            userId: user.id,
            schoolId: context.schoolId,
            admissionNo: input.admissionNo,
            admissionDate: new Date(input.admissionDate),
            admissionType: input.admissionType,
            nfcId: prepared.nfcId,
            firstName,
            lastName: familyName,
            gender: input.gender,
            dateOfBirth: new Date(input.dateOfBirth),
            address: input.address?.trim() || null,
            pinCode: input.pinCode?.trim() || null,
            bloodGroup: input.bloodGroup?.trim().toUpperCase() || null,
            motherTongue: input.motherTongue?.trim() || null,
            ...(prepared.aadhaar ? protectAadhaar(prepared.aadhaar, context.schoolId) : {}),
            aadhaarEnrolmentNo: prepared.aadhaar ? null : input.aadhaarEnrolmentNo?.trim() || null,
            previousSchool: input.previousSchool?.trim() || null,
            lastClassPassed: input.lastClassPassed?.trim() || null,
            previousPercentage:
              input.previousPercentage === undefined || input.previousPercentage === null
                ? null
                : new Prisma.Decimal(input.previousPercentage),
            previousTcNumber: input.previousTcNumber?.trim() || null,
          },
        });
        const enrollment = await transaction.enrollment.create({
          data: {
            schoolId: context.schoolId,
            academicYearId: section.academicYearId,
            studentId,
            classId: section.classId,
            sectionId: section.id,
            rollNumber: input.rollNumber?.trim() || (await this.nextRollNumber(transaction, section)),
          },
        });
        await this.linkGuardian(transaction, context.schoolId, studentId, {
          name: input.parentName.trim(),
          phone: prepared.parentMobile,
          relation: input.parentRelation?.trim() || null,
          email: input.email?.trim() || null,
          isPrimary: true,
        });
        if (input.otherParentName?.trim()) {
          await this.linkGuardian(transaction, context.schoolId, studentId, {
            name: input.otherParentName.trim(),
            phone: prepared.otherParentMobile,
            relation: null,
            email: null,
            isPrimary: false,
          });
        }
        await this.audit.record(
          context,
          {
            action: 'student.created',
            entityType: 'student',
            entityId: studentId,
            newValue: {
              admissionNo: student.admissionNo,
              firstName,
              familyName,
              section: section.label,
              rollNumber: enrollment.rollNumber,
              aadhaar: maskAadhaar(student.aadhaarLast4),
            },
          },
          transaction,
        );
        return { student, enrollment };
      });
      return {
        ...result.student,
        aadhaarMasked: maskAadhaar(result.student.aadhaarLast4),
        enrollment: result.enrollment,
        loginId: result.student.admissionNo,
        firstPassword,
        mustChangePassword: true,
      };
    } catch (error) {
      await this.supabaseAuth.deleteManagedUser(managedAuthUser.id);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A student with this admission number, Aadhaar or NFC card already exists');
      }
      throw error;
    }
  }

  /**
   * Reuses the school's guardian record when the same person (same name and mobile) is
   * already there, for example for a brother or sister; otherwise creates one.
   */
  private async linkGuardian(
    transaction: Prisma.TransactionClient,
    schoolId: string,
    studentId: string,
    parent: { name: string; phone: string | null; relation: string | null; email: string | null; isPrimary: boolean },
  ) {
    const existing = parent.phone
      ? await transaction.guardian.findFirst({
          where: { schoolId, phone: parent.phone, name: { equals: parent.name, mode: 'insensitive' } },
          select: { id: true },
        })
      : null;
    const guardian =
      existing ??
      (await transaction.guardian.create({
        data: { schoolId, name: parent.name, phone: parent.phone, relation: parent.relation, email: parent.email },
        select: { id: true },
      }));
    await transaction.studentGuardian.create({
      data: { studentId, guardianId: guardian.id, isPrimary: parent.isPrimary },
    });
  }

  /** The next free whole-number roll number in the section for its year. */
  private async nextRollNumber(transaction: Prisma.TransactionClient, section: SectionInfo) {
    const rows = await transaction.enrollment.findMany({
      where: { sectionId: section.id, academicYearId: section.academicYearId },
      select: { rollNumber: true },
    });
    const highest = rows.reduce((max, row) => {
      const value = Number(row.rollNumber);
      return Number.isInteger(value) && value > max ? value : max;
    }, 0);
    return String(highest + 1);
  }

  // ---------- lookups ----------

  private async rules(schoolId: string): Promise<RegistrationRules> {
    const settings = await this.database.schoolSettings.findUnique({
      where: { schoolId },
      select: { metadata: true },
    });
    const registration = (settings?.metadata as { registration?: Partial<RegistrationRules> } | null)?.registration;
    return {
      requireAadhaar: registration?.requireAadhaar ?? true,
      requireNfcCard: registration?.requireNfcCard ?? true,
    };
  }

  private async sectionById(schoolId: string, sectionId: string): Promise<SectionInfo> {
    const section = await this.database.section.findFirst({
      where: { id: sectionId, schoolId, isArchived: false },
      select: { id: true, classId: true, academicYearId: true, name: true, class: { select: { name: true } } },
    });
    if (!section) {
      throw new NotFoundException('Section not found in this school');
    }
    return {
      id: section.id,
      classId: section.classId,
      academicYearId: section.academicYearId,
      label: `${section.class.name}-${section.name}`,
    };
  }

  /** Sections of the given (or the active) academic year, keyed by class and section name. */
  private async sectionsByName(schoolId: string, academicYearId?: string) {
    const year = academicYearId
      ? await this.database.academicYear.findFirst({ where: { id: academicYearId, schoolId } })
      : await this.database.academicYear.findFirst({ where: { schoolId, isActive: true } });
    if (!year) {
      throw new BadRequestException(
        academicYearId ? 'Academic year not found' : 'No active academic year: activate one or pass academicYearId',
      );
    }
    const sections = await this.database.section.findMany({
      where: { schoolId, academicYearId: year.id, isArchived: false },
      select: { id: true, classId: true, academicYearId: true, name: true, class: { select: { name: true } } },
    });
    return new Map(
      sections.map((section) => [
        this.sectionKey(section.class.name, section.name),
        {
          id: section.id,
          classId: section.classId,
          academicYearId: section.academicYearId,
          label: `${section.class.name}-${section.name}`,
        },
      ]),
    );
  }

  /** "Class 8", "class 8" and "8" all match the class named "Class 8". */
  private sectionKey(className: string, sectionName: string) {
    const cls = className.toLowerCase().replace(/^class\s*/, '').replace(/\s+/g, ' ').trim();
    return `${cls}|${sectionName.toLowerCase().trim()}`;
  }

  // ---------- Excel rows ----------

  /** Maps one spreadsheet row (column names from the import template) to a student. */
  private fromRow(raw: Record<string, unknown>): { student: StudentInput; errors: string[] } {
    const errors: string[] = [];
    const gender = this.text(raw.gender).toUpperCase();
    const genderMap: Record<string, Gender> = { M: 'MALE', MALE: 'MALE', BOY: 'MALE', F: 'FEMALE', FEMALE: 'FEMALE', GIRL: 'FEMALE', O: 'OTHER', OTHER: 'OTHER' };
    const typeText = this.text(raw.admission_type).toUpperCase().replace(/[\s-]+/g, '_');
    const typeMap: Record<string, AdmissionType> = {
      NEW: 'NEW_TO_SCHOOL', NEW_TO_SCHOOL: 'NEW_TO_SCHOOL',
      EXISTING: 'EXISTING', ALREADY_STUDYING_HERE: 'EXISTING', '': 'EXISTING',
    };
    const percentageText = this.text(raw.previous_percentage).replace('%', '');
    const percentage = percentageText === '' ? undefined : Number(percentageText);
    if (percentageText !== '' && Number.isNaN(percentage)) errors.push('percentage is not a number');
    const admissionDate = this.dateText(raw.admission_date);
    const dateOfBirth = this.dateText(raw.date_of_birth);
    const student: StudentInput = {
      admissionNo: this.text(raw.admission_no),
      admissionDate,
      admissionType: typeMap[typeText] ?? (typeText as AdmissionType),
      rollNumber: this.text(raw.roll_number) || undefined,
      firstName: this.text(raw.first_name),
      familyName: this.text(raw.family_name),
      gender: genderMap[gender] ?? (gender as Gender),
      dateOfBirth,
      parentName: this.text(raw.parent_name),
      parentRelation: this.text(raw.parent_relation) || undefined,
      parentMobile: this.text(raw.parent_mobile),
      otherParentName: this.text(raw.other_parent_name) || undefined,
      otherParentMobile: this.text(raw.other_parent_mobile) || undefined,
      email: this.text(raw.email) || undefined,
      aadhaarNumber: undefined,
      aadhaarEnrolmentNo: undefined,
      nfcId: this.text(raw.nfc_card_id) || undefined,
      bloodGroup: this.text(raw.blood_group) || undefined,
      motherTongue: this.text(raw.mother_tongue) || undefined,
      address: this.text(raw.address) || undefined,
      pinCode: this.text(raw.pin_code) || undefined,
      previousSchool: this.text(raw.previous_school) || undefined,
      lastClassPassed: this.text(raw.last_class_passed) || undefined,
      previousPercentage: percentage,
      previousTcNumber: this.text(raw.previous_tc_number) || undefined,
    };
    // One column holds either the 12-digit Aadhaar or, when not issued yet, the slip number.
    const aadhaarOrSlip = this.text(raw.aadhaar_or_enrolment_no);
    if (aadhaarOrSlip) {
      if (normaliseAadhaar(aadhaarOrSlip).length === 12) student.aadhaarNumber = aadhaarOrSlip;
      else student.aadhaarEnrolmentNo = aadhaarOrSlip;
    }
    return { student, errors };
  }

  private text(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  /** Accepts 2026-06-12, 12/06/2026, 12-06-2026 (day first, as written in Indian schools). */
  private dateText(value: unknown): string {
    const text = this.text(value);
    const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (dayFirst) {
      const [, day, month, year] = dayFirst;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return text.slice(0, 10);
  }

  /** A real calendar date: 2015-02-31 is refused instead of quietly becoming 3 March. */
  private date(value: string | undefined): Date | null {
    return realDate(value);
  }

  /**
   * Shape and length of every text field, the same for the form and the import (the import
   * does not pass through the form's DTO limits). Names must be in English letters because
   * school records use them and the family name makes the first password.
   */
  private formatErrors(input: StudentInput): string[] {
    const errors: string[] = [];
    const name = (label: string, value: string | undefined, required: boolean, max = 80) => {
      const problem = nameProblem(label, value, { required, max });
      if (problem) errors.push(problem);
    };
    name('first name', input.firstName, true);
    name('family name', input.familyName, true);
    name("parent's name", input.parentName, true);
    name("other parent's name", input.otherParentName, false);
    name('parent relation', input.parentRelation, false, 30);

    const admissionNo = input.admissionNo?.trim() ?? '';
    if (admissionNo.length > 40) errors.push('admission number is longer than 40 characters');
    else if (admissionNo && !ADMISSION_NO.test(admissionNo)) {
      errors.push('admission number can only contain letters, numbers, /, -, . and spaces');
    }
    const card = input.nfcId?.trim() ?? '';
    if (card.length > 64) errors.push('NFC card ID is longer than 64 characters');
    else if (card && !CARD_ID.test(card)) errors.push('NFC card ID can only contain letters, numbers, :, _ and -');
    const roll = input.rollNumber?.trim() ?? '';
    if (roll && !/^[A-Za-z0-9]{1,10}$/.test(roll)) errors.push('roll number must be up to 10 letters or numbers');
    const email = input.email?.trim() ?? '';
    if (email && (email.length > 120 || !EMAIL.test(email))) errors.push('email is not a valid email address');

    // Free text: limited length, no markup or control characters, and no leading = + @ that a
    // spreadsheet would run as a formula when the data is exported.
    const free: [string, string | undefined, number][] = [
      ['address', input.address, 300],
      ['mother tongue', input.motherTongue, 40],
      ['previous school', input.previousSchool, 120],
      ['last class passed', input.lastClassPassed, 30],
      ['previous TC number', input.previousTcNumber, 40],
      ['enrolment slip number', input.aadhaarEnrolmentNo, 40],
    ];
    for (const [label, value, max] of free) {
      const text = value?.trim() ?? '';
      if (!text) continue;
      if (text.length > max) errors.push(`${label} is longer than ${max} characters`);
      else if (/[<>\x00-\x1F\x7F]/.test(text)) errors.push(`${label} cannot contain < > or control characters`);
      else if (/^[=+@]/.test(text)) errors.push(`${label} cannot start with =, + or @`);
    }
    return errors;
  }
}
