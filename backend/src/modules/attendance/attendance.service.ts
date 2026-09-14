import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateAttendanceDto) {
    const user = await this.getUser(authUser);
    const enrollment = await this.database.enrollment.findFirst({
      where: { id: input.enrollmentId, schoolId: user.schoolId },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');

    try {
      return await this.database.attendanceRecord.create({
        data: {
          schoolId: user.schoolId,
          enrollmentId: enrollment.id,
          attendanceDate: new Date(input.attendanceDate),
          status: input.status,
          remarks: input.remarks?.trim() || null,
          markedById: user.id,
        },
        include: this.includeRelations(),
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Attendance already exists for this student and date');
      }
      throw error;
    }
  }

  async findMany(
    authUser: SupabaseUser,
    filters: { attendanceDate?: string; enrollmentId?: string },
  ) {
    const user = await this.getUser(authUser);
    return this.database.attendanceRecord.findMany({
      where: {
        schoolId: user.schoolId,
        ...(filters.attendanceDate
          ? { attendanceDate: new Date(filters.attendanceDate) }
          : {}),
        ...(filters.enrollmentId ? { enrollmentId: filters.enrollmentId } : {}),
      },
      orderBy: [{ attendanceDate: 'desc' }, { createdAt: 'desc' }],
      include: this.includeRelations(),
    });
  }

  async findOne(authUser: SupabaseUser, attendanceId: string) {
    const user = await this.getUser(authUser);
    const record = await this.database.attendanceRecord.findFirst({
      where: { id: attendanceId, schoolId: user.schoolId },
      include: this.includeRelations(),
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    return record;
  }

  async update(
    authUser: SupabaseUser,
    attendanceId: string,
    input: UpdateAttendanceDto,
  ) {
    const existing = await this.findOne(authUser, attendanceId);
    return this.database.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        remarks: input.remarks === undefined ? undefined : input.remarks.trim() || null,
      },
      include: this.includeRelations(),
    });
  }

  private includeRelations() {
    return {
      enrollment: {
        include: { student: true, class: true, section: true, academicYear: true },
      },
      markedBy: { select: { id: true, displayName: true, email: true } },
    };
  }

  private async getUser(authUser: SupabaseUser) {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { id: true, schoolId: true, status: true },
    });
    if (!user) throw new ForbiddenException('ERP user profile is required');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('ERP user is not active');
    if (!user.schoolId) throw new ForbiddenException('ERP user is not assigned to a school');
    return { id: user.id, schoolId: user.schoolId };
  }

  private isUniqueError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
