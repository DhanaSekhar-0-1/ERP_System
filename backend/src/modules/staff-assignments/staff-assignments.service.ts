import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateStaffAssignmentDto } from './dto/create-staff-assignment.dto';

@Injectable()
export class StaffAssignmentsService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateStaffAssignmentDto) {
    const schoolId = await this.getSchoolId(authUser);
    const [staff, academicYear, schoolClass, subject] = await Promise.all([
      this.database.staffProfile.findFirst({ where: { id: input.staffId, schoolId } }),
      this.database.academicYear.findFirst({ where: { id: input.academicYearId, schoolId } }),
      this.database.schoolClass.findFirst({
        where: { id: input.classId, schoolId, academicYearId: input.academicYearId },
      }),
      this.database.subject.findFirst({
        where: { id: input.subjectId, schoolId, academicYearId: input.academicYearId },
      }),
    ]);
    if (!staff || !academicYear || !schoolClass || !subject) {
      throw new NotFoundException('Staff, academic year, class, or subject not found');
    }

    try {
      return await this.database.staffAssignment.create({
        data: {
          schoolId,
          staffId: staff.id,
          academicYearId: academicYear.id,
          classId: schoolClass.id,
          subjectId: subject.id,
        },
        include: {
          staff: { include: { user: true } },
          class: true,
          subject: true,
          academicYear: true,
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('This staff assignment already exists');
      }
      throw error;
    }
  }

  async findMany(
    authUser: SupabaseUser,
    filters: { staffId?: string; classId?: string; academicYearId?: string },
  ) {
    const schoolId = await this.getSchoolId(authUser);
    return this.database.staffAssignment.findMany({
      where: {
        schoolId,
        ...(filters.staffId ? { staffId: filters.staffId } : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      },
      orderBy: [{ academicYearId: 'asc' }, { classId: 'asc' }],
      include: {
        staff: { include: { user: true } },
        class: true,
        subject: true,
        academicYear: true,
      },
    });
  }

  async remove(authUser: SupabaseUser, assignmentId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const existing = await this.database.staffAssignment.findFirst({
      where: { id: assignmentId, schoolId },
    });
    if (!existing) {
      throw new NotFoundException('Staff assignment not found');
    }
    return this.database.staffAssignment.delete({ where: { id: assignmentId } });
  }

  private async getSchoolId(authUser: SupabaseUser): Promise<string> {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { schoolId: true, status: true },
    });
    if (!user) throw new ForbiddenException('ERP user profile is required');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('ERP user is not active');
    if (!user.schoolId) throw new ForbiddenException('ERP user is not assigned to a school');
    return user.schoolId;
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
