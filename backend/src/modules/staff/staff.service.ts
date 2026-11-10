import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ROLE } from '../../common/access/roles';
import { CreateStaffDto } from './dto/create-staff.dto';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { defaultSubjects } from '../../common/academics/default-subjects';
import { normaliseMobile } from '../../common/identity/first-password';
import { randomFirstPassword, teacherCode } from '../../common/identity/teacher-id';
import { ageInYears, nameProblem, realDate } from '../../common/identity/text-rules';
import { UpdateStaffDto } from './dto/update-staff.dto';

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  phone: true,
  status: true,
} as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registers a teacher (MVP1, docs/mvp-plan.md): School Admin or Super Admin only. The app
   * makes the Teacher ID (T26A05) from the school's counter, which is also the login ID, and a
   * random first password that is shown once and must be changed at first login.
   */
  async create(authUser: SupabaseUser, input: CreateStaffDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can register teachers');
    const checked = await this.checkTeacher(context.schoolId, input);
    if (checked.errors.length) {
      throw new BadRequestException(checked.errors.join('; '));
    }

    const staffId = randomUUID();
    const firstPassword = randomFirstPassword();
    const displayName = input.displayName.trim();
    const loginEmail = checked.email ?? `${staffId}@staff.erp.local`;
    const account = await this.supabaseAuth.createManagedUser({
      email: loginEmail,
      password: firstPassword,
      displayName,
    });

    try {
      const staff = await this.database.$transaction(async (transaction) => {
        const teacherId = await this.nextTeacherId(transaction, context.schoolId, checked.joiningDate);
        const teacherRole = await transaction.role.findUniqueOrThrow({ where: { name: ROLE.TEACHER } });
        const user = await transaction.user.create({
          data: {
            authUserId: account.id,
            email: loginEmail,
            displayName,
            phone: checked.phone,
            status: 'ACTIVE',
            mustChangePassword: true,
            organizationId: context.organizationId,
            schoolId: context.schoolId,
          },
        });
        await transaction.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
        const created = await transaction.staffProfile.create({
          data: {
            id: staffId,
            userId: user.id,
            schoolId: context.schoolId,
            employeeNo: teacherId,
            nfcId: checked.nfcId,
            joiningDate: checked.joiningDate,
            gender: input.gender ?? null,
            dateOfBirth: checked.dateOfBirth,
            address: input.address?.trim() || null,
            teachingSubjects: checked.subjects,
          },
          include: { user: { select: USER_SELECT } },
        });
        await this.audit.record(
          context,
          {
            action: 'staff.created',
            entityType: 'staff',
            entityId: created.id,
            newValue: { teacherId, displayName, subjects: checked.subjects },
          },
          transaction,
        );
        return created;
      });
      return {
        ...staff,
        teacherId: staff.employeeNo,
        loginId: staff.employeeNo,
        firstPassword,
        mustChangePassword: true,
      };
    } catch (error) {
      await this.supabaseAuth.deleteManagedUser(account.id);
      if (this.isUniqueError(error)) {
        throw new ConflictException('This email or NFC card is already in use');
      }
      throw error;
    }
  }

  /** Subjects a teacher can be registered for: the school's default list and its class subjects. */
  async teachingSubjectOptions(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return [...(await this.subjectNames(context.schoolId)).values()].sort((a, b) => a.localeCompare(b));
  }

  private async subjectNames(schoolId: string): Promise<Map<string, string>> {
    const [defaults, subjects] = await Promise.all([
      defaultSubjects(this.database, schoolId),
      this.database.subject.findMany({ where: { schoolId }, select: { name: true }, distinct: ['name'] }),
    ]);
    const names = new Map<string, string>();
    for (const name of [...defaults.map((d) => d.name), ...subjects.map((s) => s.name)]) {
      const key = name.trim().toLowerCase();
      if (key && !names.has(key)) names.set(key, name.trim());
    }
    return names;
  }

  private async checkTeacher(schoolId: string, input: CreateStaffDto) {
    const errors: string[] = [];
    const nameError = nameProblem('full name', input.displayName, { required: true });
    if (nameError) errors.push(nameError);

    const phone = input.phone ? normaliseMobile(input.phone) : null;
    if (!phone) errors.push('mobile must be a 10-digit mobile number');

    const joiningDate = realDate(input.joiningDate);
    const nextYear = Date.now() + 365 * 86_400_000;
    if (!joiningDate) errors.push('joining date is missing or not a date');
    else if (joiningDate.getTime() > nextYear) errors.push('joining date is more than a year away');
    else if (joiningDate.getUTCFullYear() < 1970) errors.push('joining date is before 1970');

    let dateOfBirth: Date | null = null;
    if (input.dateOfBirth) {
      dateOfBirth = realDate(input.dateOfBirth);
      if (!dateOfBirth) errors.push('date of birth is not a date');
      else {
        const age = ageInYears(dateOfBirth);
        if (age < 18 || age > 80) errors.push('date of birth gives an age outside 18 to 80 years');
      }
    }

    const known = await this.subjectNames(schoolId);
    const subjects: string[] = [];
    for (const raw of input.teachingSubjects ?? []) {
      const canonical = known.get(raw.trim().toLowerCase());
      if (!canonical) errors.push(`subject "${raw.trim()}" is not in the school's subject list`);
      else if (!subjects.includes(canonical)) subjects.push(canonical);
    }
    if (!subjects.length && !errors.some((e) => e.startsWith('subject'))) {
      errors.push('choose at least one subject');
    }

    const address = input.address?.trim() ?? '';
    if (address && (/[<>\x00-\x1F\x7F]/.test(address) || /^[=+@]/.test(address))) {
      errors.push('address cannot contain < > or control characters, or start with =, + or @');
    }

    let email: string | null = null;
    if (input.email?.trim()) {
      email = input.email.trim().toLowerCase();
      const taken = await this.database.user.findUnique({ where: { email }, select: { id: true } });
      if (taken) errors.push('this email is already used by another account');
    }

    let nfcId: string | null = null;
    if (input.nfcId?.trim()) {
      nfcId = input.nfcId.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9:_-]*$/.test(nfcId)) {
        errors.push('NFC card ID can only contain letters, numbers, :, _ and -');
      } else {
        const [student, staff] = await Promise.all([
          this.database.student.findUnique({ where: { nfcId }, select: { id: true } }),
          this.database.staffProfile.findUnique({ where: { nfcId }, select: { id: true } }),
        ]);
        if (student || staff) errors.push(`card ${nfcId} is already given to someone else`);
      }
    }

    return { errors, phone, joiningDate: joiningDate as Date, dateOfBirth, subjects, email, nfcId };
  }

  /**
   * The next Teacher ID from the school's counter, inside the registration transaction, so two
   * registrations at once cannot get the same ID. Skips any number already used (for example an
   * employee number typed by hand before MVP1).
   */
  private async nextTeacherId(
    transaction: Prisma.TransactionClient,
    schoolId: string,
    joiningDate: Date,
  ): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const sequence = await transaction.idSequence.upsert({
        where: { schoolId_kind: { schoolId, kind: 'teacher' } },
        create: { schoolId, kind: 'teacher', lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const code = teacherCode(joiningDate.getUTCFullYear(), sequence.lastValue);
      const used = await transaction.staffProfile.findFirst({
        where: { schoolId, employeeNo: { equals: code, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!used) return code;
    }
    throw new ConflictException('Could not find a free Teacher ID; try again');
  }

  async findMany(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    return this.database.staffProfile.findMany({
      where: { schoolId: context.schoolId },
      orderBy: { employeeNo: 'asc' },
      include: { user: { select: USER_SELECT } },
    });
  }

  async findOne(authUser: SupabaseUser, staffId: string) {
    const context = await this.access.schoolContext(authUser);
    if (!context.isLeader && context.staffId !== staffId) {
      this.access.assertLeader(context);
    }
    return this.scoped(context, staffId);
  }

  async update(authUser: SupabaseUser, staffId: string, input: UpdateStaffDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const existing = await this.scoped(context, staffId);
    if (input.nfcId !== undefined) {
      await this.assertNfcFree(input.nfcId);
    }
    try {
      const updated = await this.database.$transaction(async (transaction) => {
        const staff = await transaction.staffProfile.update({
          where: { id: staffId },
          data: {
            employeeNo: input.employeeNo?.trim(),
            nfcId: input.nfcId?.trim().toUpperCase(),
            designation: input.designation === undefined ? undefined : input.designation.trim() || null,
          },
        });
        if (input.displayName !== undefined || input.phone !== undefined) {
          await transaction.user.update({
            where: { id: staff.userId },
            data: {
              displayName: input.displayName?.trim(),
              phone: input.phone === undefined ? undefined : input.phone.trim() || null,
            },
          });
        }
        await this.audit.record(
          context,
          {
            action: 'staff.updated',
            entityType: 'staff',
            entityId: staffId,
            oldValue: {
              employeeNo: existing.employeeNo,
              nfcId: existing.nfcId,
              displayName: existing.user.displayName,
            },
            newValue: input,
          },
          transaction,
        );
        return transaction.staffProfile.findUniqueOrThrow({
          where: { id: staff.id },
          include: { user: { select: USER_SELECT } },
        });
      });
      if (input.displayName) {
        await this.supabaseAuth.updateManagedUser(
          (await this.database.user.findUniqueOrThrow({ where: { id: existing.userId } })).authUserId,
          { displayName: input.displayName.trim() },
        );
      }
      return updated;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Employee number or NFC ID already exists');
      }
      throw error;
    }
  }

  async setActive(authUser: SupabaseUser, staffId: string, active: boolean) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const staff = await this.scoped(context, staffId);
    if (staff.userId === context.userId) {
      throw new BadRequestException('You cannot change your own account status');
    }
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: staff.userId },
        data: { status: active ? 'ACTIVE' : 'SUSPENDED' },
        select: USER_SELECT,
      });
      if (!active) {
        await transaction.userSession.updateMany({
          where: { userId: staff.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        context,
        {
          action: active ? 'staff.activated' : 'staff.deactivated',
          entityType: 'staff',
          entityId: staffId,
        },
        transaction,
      );
      return { ...staff, user };
    });
  }

  private async scoped(context: SchoolContext, staffId: string) {
    const staff = await this.database.staffProfile.findFirst({
      where: { id: staffId, schoolId: context.schoolId },
      include: { user: { select: USER_SELECT } },
    });
    if (!staff) throw new NotFoundException('Staff profile not found');
    return staff;
  }

  private async assertNfcFree(nfcId: string) {
    const studentWithNfc = await this.database.student.findUnique({
      where: { nfcId: nfcId.trim().toUpperCase() },
      select: { id: true },
    });
    if (studentWithNfc) {
      throw new ConflictException('This NFC ID is already assigned to a student');
    }
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
