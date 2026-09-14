import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsDto } from './dto/list-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@Injectable()
export class StudentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
  ) {}

  async create(
    authUser: SupabaseUser,
    input: CreateStudentDto,
  ) {
    const user = await this.getScopedUser(authUser);
    const staffWithNfc = await this.database.staffProfile.findUnique({
      where: { nfcId: input.nfcId.trim() },
      select: { id: true },
    });
    if (staffWithNfc) {
      throw new ConflictException('This NFC ID is already assigned to staff');
    }

    const studentId = randomUUID();
    const displayName = `${input.firstName.trim()} ${input.lastName?.trim() ?? ''}`.trim();
    const loginEmail = `${studentId}@students.erp.local`;
    const managedAuthUser = await this.supabaseAuth.createManagedUser({
      email: loginEmail,
      password: input.password,
      displayName,
    });

    try {
      const result = await this.database.$transaction(async (transaction) => {
        const studentRole = await transaction.role.findUnique({
          where: { name: 'Student' },
        });
        if (!studentRole) {
          throw new NotFoundException('Student role is missing; run the seed first');
        }
        const erpUser = await transaction.user.create({
          data: {
            authUserId: managedAuthUser.id,
            email: loginEmail,
            displayName,
            status: 'ACTIVE',
            schoolId: user.schoolId,
          },
        });
        await transaction.userRole.create({
          data: { userId: erpUser.id, roleId: studentRole.id },
        });
        return transaction.student.create({
          data: {
            id: studentId,
            userId: erpUser.id,
            schoolId: user.schoolId,
            admissionNo: input.admissionNo.trim(),
            nfcId: input.nfcId.trim(),
            firstName: input.firstName.trim(),
            lastName: input.lastName?.trim() || null,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          },
        });
      });
      return { ...result, loginId: result.id };
    } catch (error) {
      await this.supabaseAuth.deleteManagedUser(managedAuthUser.id);
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A student with this admission number or NFC ID already exists',
        );
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser, input: ListStudentsDto) {
    const user = await this.getScopedUser(authUser);
    const skip = (input.page - 1) * input.limit;
    const search = input.search?.trim();
    const where = {
      schoolId: user.schoolId,
      ...(search
        ? {
            OR: [
              { admissionNo: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.database.$transaction([
      this.database.student.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip,
        take: input.limit,
      }),
      this.database.student.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  async findOne(authUser: SupabaseUser, studentId: string) {
    const user = await this.getScopedUser(authUser);
    const student = await this.database.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return student;
  }

  async update(
    authUser: SupabaseUser,
    studentId: string,
    input: UpdateStudentDto,
  ) {
    const user = await this.getScopedUser(authUser);
    const existing = await this.database.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId },
    });

    if (!existing) {
      throw new NotFoundException('Student not found');
    }

    if (input.nfcId !== undefined) {
      const staffWithNfc = await this.database.staffProfile.findUnique({
        where: { nfcId: input.nfcId.trim() },
        select: { id: true },
      });
      if (staffWithNfc) {
        throw new ConflictException('This NFC ID is already assigned to staff');
      }
    }

    try {
      return await this.database.student.update({
        where: { id: studentId },
        data: {
          admissionNo: input.admissionNo?.trim(),
          nfcId: input.nfcId?.trim(),
          firstName: input.firstName?.trim(),
          lastName:
            input.lastName === undefined ? undefined : input.lastName.trim() || null,
          dateOfBirth:
            input.dateOfBirth === undefined
              ? undefined
              : new Date(input.dateOfBirth),
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A student with this admission number or NFC ID already exists',
        );
      }
      throw error;
    }
  }

  private async getScopedUser(authUser: SupabaseUser) {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { id: true, schoolId: true, status: true },
    });

    if (!user) {
      throw new ForbiddenException('ERP user profile is required');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('ERP user is not active');
    }

    if (!user.schoolId) {
      throw new ForbiddenException('ERP user is not assigned to a school');
    }

    return {
      id: user.id,
      schoolId: user.schoolId,
      status: user.status,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
