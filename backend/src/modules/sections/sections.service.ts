import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';

@Injectable()
export class SectionsService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateSectionDto) {
    const schoolId = await this.getSchoolId(authUser);
    const schoolClass = await this.database.schoolClass.findFirst({
      where: {
        id: input.classId,
        schoolId,
        academicYearId: input.academicYearId,
      },
    });
    if (!schoolClass) {
      throw new NotFoundException('Class or academic year not found');
    }

    try {
      return await this.database.section.create({
        data: {
          schoolId,
          classId: schoolClass.id,
          academicYearId: schoolClass.academicYearId,
          name: input.name.trim(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Section name already exists for this class');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser, classId?: string) {
    const schoolId = await this.getSchoolId(authUser);
    if (classId) {
      const schoolClass = await this.database.schoolClass.findFirst({
        where: { id: classId, schoolId },
      });
      if (!schoolClass) {
        throw new NotFoundException('Class not found');
      }
    }
    return this.database.section.findMany({
      where: { schoolId, ...(classId ? { classId } : {}) },
      orderBy: { name: 'asc' },
      include: { class: true, _count: { select: { enrollments: true } } },
    });
  }

  async findOne(authUser: SupabaseUser, sectionId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const section = await this.database.section.findFirst({
      where: { id: sectionId, schoolId },
      include: { class: true, _count: { select: { enrollments: true } } },
    });
    if (!section) {
      throw new NotFoundException('Section not found');
    }
    return section;
  }

  async update(
    authUser: SupabaseUser,
    sectionId: string,
    input: UpdateSectionDto,
  ) {
    const existing = await this.findOne(authUser, sectionId);
    try {
      return await this.database.section.update({
        where: { id: existing.id },
        data: { name: input.name === undefined ? undefined : input.name.trim() },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Section name already exists for this class');
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
