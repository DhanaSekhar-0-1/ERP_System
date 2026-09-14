import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { LinkStudentDto } from './dto/link-student.dto';
import { ListGuardiansDto } from './dto/list-guardians.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';

@Injectable()
export class GuardiansService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateGuardianDto) {
    const user = await this.getScopedUser(authUser);
    return this.database.guardian.create({
      data: {
        schoolId: user.schoolId,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
      },
    });
  }

  async findMany(authUser: SupabaseUser, input: ListGuardiansDto) {
    const user = await this.getScopedUser(authUser);
    const search = input.search?.trim();
    const where = {
      schoolId: user.schoolId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const skip = (input.page - 1) * input.limit;
    const [items, total] = await this.database.$transaction([
      this.database.guardian.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: input.limit,
        include: {
          students: {
            select: {
              isPrimary: true,
              student: {
                select: { id: true, admissionNo: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      this.database.guardian.count({ where }),
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

  async findOne(authUser: SupabaseUser, guardianId: string) {
    const user = await this.getScopedUser(authUser);
    const guardian = await this.database.guardian.findFirst({
      where: { id: guardianId, schoolId: user.schoolId },
      include: {
        students: {
          select: {
            isPrimary: true,
            student: {
              select: { id: true, admissionNo: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!guardian) {
      throw new NotFoundException('Guardian not found');
    }
    return guardian;
  }

  async update(
    authUser: SupabaseUser,
    guardianId: string,
    input: UpdateGuardianDto,
  ) {
    const user = await this.getScopedUser(authUser);
    const existing = await this.database.guardian.findFirst({
      where: { id: guardianId, schoolId: user.schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Guardian not found');
    }

    return this.database.guardian.update({
      where: { id: guardianId },
      data: {
        name: input.name === undefined ? undefined : input.name.trim(),
        phone: input.phone === undefined ? undefined : input.phone.trim() || null,
      },
    });
  }

  async linkStudent(
    authUser: SupabaseUser,
    guardianId: string,
    input: LinkStudentDto,
  ) {
    const user = await this.getScopedUser(authUser);
    const [guardian, student] = await Promise.all([
      this.database.guardian.findFirst({
        where: { id: guardianId, schoolId: user.schoolId },
      }),
      this.database.student.findFirst({
        where: { id: input.studentId, schoolId: user.schoolId },
      }),
    ]);

    if (!guardian || !student) {
      throw new NotFoundException('Guardian or student not found');
    }

    try {
      return await this.database.studentGuardian.create({
        data: {
          guardianId,
          studentId: input.studentId,
          isPrimary: input.isPrimary,
        },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Guardian is already linked to this student');
      }
      throw error;
    }
  }

  private async getScopedUser(authUser: SupabaseUser) {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { schoolId: true, status: true },
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
    return { schoolId: user.schoolId };
  }
}
