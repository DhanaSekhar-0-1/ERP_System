import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateEnrollmentDto) {
    const schoolId = await this.getSchoolId(authUser);
    const [student, academicYear, schoolClass, section] = await Promise.all([
      this.database.student.findFirst({ where: { id: input.studentId, schoolId } }),
      this.database.academicYear.findFirst({ where: { id: input.academicYearId, schoolId } }),
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId, academicYearId: input.academicYearId },
      }),
      this.database.section.findFirst({
        where: {
          id: input.sectionId,
          schoolId,
          classId: input.classId,
          academicYearId: input.academicYearId,
        },
      }),
    ]);
    if (!student || !academicYear || !schoolClass || !section) {
      throw new NotFoundException(
        'Student, academic year, class, or section not found',
      );
    }

    try {
      return await this.database.enrollment.create({
        data: {
          schoolId,
          studentId: student.id,
          academicYearId: academicYear.id,
          classId: schoolClass.id,
          sectionId: section.id,
          rollNumber: input.rollNumber?.trim() || null,
        },
        include: this.includeRelations(),
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException(
          'This student is already enrolled for the academic year',
        );
      }
      throw error;
    }
  }

  async findMany(
    authUser: SupabaseUser,
    filters: {
      academicYearId?: string;
      classId?: string;
      sectionId?: string;
      studentId?: string;
    },
  ) {
    const schoolId = await this.getSchoolId(authUser);
    return this.database.enrollment.findMany({
      where: {
        schoolId,
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...(filters.studentId ? { studentId: filters.studentId } : {}),
      },
      orderBy: [{ academicYearId: 'desc' }, { rollNumber: 'asc' }],
      include: this.includeRelations(),
    });
  }

  async findOne(authUser: SupabaseUser, enrollmentId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const enrollment = await this.database.enrollment.findFirst({
      where: { id: enrollmentId, schoolId },
      include: this.includeRelations(),
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }
    return enrollment;
  }

  async update(
    authUser: SupabaseUser,
    enrollmentId: string,
    input: UpdateEnrollmentDto,
  ) {
    const existing = await this.findOne(authUser, enrollmentId);
    return this.database.enrollment.update({
      where: { id: existing.id },
      data: {
        rollNumber:
          input.rollNumber === undefined ? undefined : input.rollNumber.trim() || null,
        status: input.status,
      },
      include: this.includeRelations(),
    });
  }

  private includeRelations() {
    return {
      student: true,
      academicYear: true,
      class: true,
      section: true,
    };
  }

  private async getSchoolId(authUser: SupabaseUser): Promise<string> {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { schoolId: true, status: true },
    });
    if (!user) throw new ForbiddenException('ERP user profile is required');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('ERP user is not active');
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
