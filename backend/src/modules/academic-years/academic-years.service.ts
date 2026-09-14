import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';

@Injectable()
export class AcademicYearsService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateAcademicYearDto) {
    const schoolId = await this.getSchoolId(authUser);
    const dates = this.parseDates(input.startsOn, input.endsOn);
    try {
      return await this.database.academicYear.create({
        data: {
          schoolId,
          name: input.name.trim(),
          startsOn: dates.startsOn,
          endsOn: dates.endsOn,
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Academic year name already exists in this school');
      }
      throw error;
    }
  }

  async findMany(authUser: SupabaseUser) {
    const schoolId = await this.getSchoolId(authUser);
    return this.database.academicYear.findMany({
      where: { schoolId },
      orderBy: { startsOn: 'desc' },
    });
  }

  async findOne(authUser: SupabaseUser, academicYearId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const academicYear = await this.database.academicYear.findFirst({
      where: { id: academicYearId, schoolId },
    });
    if (!academicYear) {
      throw new NotFoundException('Academic year not found');
    }
    return academicYear;
  }

  async update(
    authUser: SupabaseUser,
    academicYearId: string,
    input: UpdateAcademicYearDto,
  ) {
    const existing = await this.findOne(authUser, academicYearId);
    const startsOn = input.startsOn
      ? new Date(input.startsOn)
      : existing.startsOn;
    const endsOn = input.endsOn ? new Date(input.endsOn) : existing.endsOn;
    if (startsOn >= endsOn) {
      throw new BadRequestException('Academic year start must be before its end');
    }

    try {
      return await this.database.academicYear.update({
        where: { id: existing.id },
        data: {
          name: input.name === undefined ? undefined : input.name.trim(),
          startsOn: input.startsOn ? startsOn : undefined,
          endsOn: input.endsOn ? endsOn : undefined,
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Academic year name already exists in this school');
      }
      throw error;
    }
  }

  async activate(authUser: SupabaseUser, academicYearId: string) {
    const schoolId = await this.getSchoolId(authUser);
    const existing = await this.findOne(authUser, academicYearId);
    return this.database.$transaction(async (transaction) => {
      await transaction.academicYear.updateMany({
        where: { schoolId, id: { not: existing.id } },
        data: { isActive: false },
      });
      return transaction.academicYear.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    });
  }

  private parseDates(startsOn: string, endsOn: string) {
    const starts = new Date(startsOn);
    const ends = new Date(endsOn);
    if (starts >= ends) {
      throw new BadRequestException('Academic year start must be before its end');
    }
    return { startsOn: starts, endsOn: ends };
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
