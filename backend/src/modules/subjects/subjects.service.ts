import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

@Injectable()
export class SubjectsService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateSubjectDto) {
    const schoolId = await this.getSchoolId(authUser);
    const academicYear = await this.database.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }

    try {
      return await this.database.subject.create({
        data: {
          schoolId,
          academicYearId: academicYear.id,
          name: input.name.trim(),
          code: input.code.trim().toUpperCase(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Subject code already exists for this academic year');
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
    return this.database.subject.findMany({
      where: { schoolId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
      include: { academicYear: true },
    });
  }

  async findOne(authUser: SupabaseUser, subjectId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const subject = await this.database.subject.findFirst({
      where: { id: subjectId, schoolId },
      include: { academicYear: true },
    });
    if (!subject) {
      throw new NotFoundException('Subject not found');
    }
    return subject;
  }

  async update(
    authUser: SupabaseUser,
    subjectId: string,
    input: UpdateSubjectDto,
  ) {
    const schoolId = await this.getSchoolId(authUser);
    const existing = await this.database.subject.findFirst({
      where: { id: subjectId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Subject not found');
    }

    try {
      return await this.database.subject.update({
        where: { id: subjectId },
        data: {
          name: input.name === undefined ? undefined : input.name.trim(),
          code: input.code === undefined ? undefined : input.code.trim().toUpperCase(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Subject code already exists for this academic year');
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
