import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

@Injectable()
export class ClassesService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateClassDto) {
    const schoolId = await this.getSchoolId(authUser);
    const academicYear = await this.database.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    try {
      return await this.database.schoolClass.create({
        data: {
          schoolId,
          academicYearId: academicYear.id,
          name: input.name.trim(),
          sortOrder: input.sortOrder ?? 0,
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Class name already exists for this academic year');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser, academicYearId?: string) {
    const schoolId = await this.getSchoolId(authUser);
    if (academicYearId) {
      const academicYear = await this.database.academicYear.findFirst({
        where: { id: academicYearId, schoolId },
      });
      if (!academicYear) {
        throw new NotFoundException('Academic year not found');
      }
    }
    return this.database.schoolClass.findMany({
      where: { schoolId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { sections: true, enrollments: true } } },
    });
  }

  async findOne(authUser: SupabaseUser, classId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const schoolClass = await this.database.schoolClass.findFirst({
      where: { id: classId, schoolId },
      include: { _count: { select: { sections: true, enrollments: true } } },
    });
    if (!schoolClass) {
      throw new NotFoundException('Class not found');
    }
    return schoolClass;
  }

  async update(
    authUser: SupabaseUser,
    classId: string,
    input: UpdateClassDto,
  ) {
    const schoolId = await this.getSchoolId(authUser);
    const existing = await this.database.schoolClass.findFirst({
      where: { id: classId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Class not found');
    }

    try {
      return await this.database.schoolClass.update({
        where: { id: classId },
        data: {
          name: input.name === undefined ? undefined : input.name.trim(),
          sortOrder: input.sortOrder,
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Class name already exists for this academic year');
      }
      throw error;
    }
  }

  private async getSchoolId(authUser: SupabaseUser): Promise<string> {
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
    return user.schoolId;
  }

  private isUniqueError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
