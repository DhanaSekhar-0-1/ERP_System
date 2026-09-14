import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { UpdateSchoolSettingsDto } from './dto/update-school-settings.dto';

@Injectable()
export class SchoolsService {
  constructor(private readonly database: DatabaseService) {}

  async findForOrganization(authUser: SupabaseUser, organizationId: string) {
    const actor = await this.getActor(authUser);
    await this.findOrganization(organizationId);
    if (
      !this.isSuperAdmin(actor) &&
      (!actor.schoolId || actor.organizationId !== organizationId)
    ) {
      throw new ForbiddenException('Organization school access is not permitted');
    }
    const where = this.isSuperAdmin(actor)
      ? { organizationId }
      : { organizationId, id: actor.schoolId as string };
    return this.database.school.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { settings: true },
    });
  }

  async createForOrganization(
    authUser: SupabaseUser,
    organizationId: string,
    input: CreateSchoolDto,
  ) {
    const actor = await this.getActor(authUser);
    this.assertSuperAdmin(actor);
    await this.findOrganization(organizationId);
    try {
      return await this.database.school.create({
        data: {
          organizationId,
          name: input.name.trim(),
          code: input.code.trim().toUpperCase(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('School code already exists in this organization');
      }
      throw error;
    }
  }

  async findOne(authUser: SupabaseUser, schoolId: string) {
    const actor = await this.getActor(authUser);
    const school = await this.database.school.findUnique({
      where: { id: schoolId },
      include: { settings: true },
    });
    if (!school) {
      throw new NotFoundException('School not found');
    }
    this.assertRead(actor, school.id);
    return school;
  }

  async update(
    authUser: SupabaseUser,
    schoolId: string,
    input: UpdateSchoolDto,
  ) {
    const actor = await this.getActor(authUser);
    const existing = await this.findOne(authUser, schoolId);
    this.assertManage(actor, existing.id);
    try {
      return await this.database.school.update({
        where: { id: existing.id },
        data: {
          name: input.name === undefined ? undefined : input.name.trim(),
          code:
            input.code === undefined
              ? undefined
              : input.code.trim().toUpperCase(),
        },
        include: { settings: true },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('School code already exists in this organization');
      }
      throw error;
    }
  }

  async archive(authUser: SupabaseUser, schoolId: string) {
    const actor = await this.getActor(authUser);
    const school = await this.findOne(authUser, schoolId);
    this.assertManage(actor, school.id);
    if (school.isArchived) {
      throw new BadRequestException('School is already archived');
    }
    return this.database.school.update({
      where: { id: school.id },
      data: { isArchived: true },
      include: { settings: true },
    });
  }

  async restore(authUser: SupabaseUser, schoolId: string) {
    const actor = await this.getActor(authUser);
    const school = await this.findOne(authUser, schoolId);
    this.assertManage(actor, school.id);
    if (!school.isArchived) {
      throw new BadRequestException('School is already active');
    }
    return this.database.school.update({
      where: { id: school.id },
      data: { isArchived: false },
      include: { settings: true },
    });
  }

  async getSettings(authUser: SupabaseUser, schoolId: string) {
    const school = await this.findOne(authUser, schoolId);
    return this.database.schoolSettings.findUnique({
      where: { schoolId: school.id },
    });
  }

  async updateSettings(
    authUser: SupabaseUser,
    schoolId: string,
    input: UpdateSchoolSettingsDto,
  ) {
    const actor = await this.getActor(authUser);
    const school = await this.findOne(authUser, schoolId);
    this.assertManage(actor, school.id);
    return this.database.schoolSettings.upsert({
      where: { schoolId: school.id },
      create: {
        schoolId: school.id,
        address: input.address,
        phone: input.phone,
        email: input.email,
        timezone: input.timezone ?? 'UTC',
        metadata: input.metadata,
      },
      update: {
        address: input.address,
        phone: input.phone,
        email: input.email,
        timezone: input.timezone,
        metadata: input.metadata,
      },
    });
  }

  private async getActor(authUser: SupabaseUser) {
    const actor = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        status: true,
        organizationId: true,
        schoolId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!actor) {
      throw new ForbiddenException('ERP user profile is required');
    }
    if (actor.status !== 'ACTIVE') {
      throw new ForbiddenException('ERP user is not active');
    }
    return actor;
  }

  private async findOrganization(organizationId: string) {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  private assertRead(
    actor: { schoolId: string | null; roles: { role: { name: string } }[] },
    schoolId: string,
  ) {
    if (!this.isSuperAdmin(actor) && actor.schoolId !== schoolId) {
      throw new ForbiddenException('School access is not permitted');
    }
  }

  private assertManage(
    actor: {
      schoolId: string | null;
      roles: { role: { name: string } }[];
    },
    schoolId: string,
  ) {
    if (
      !this.isSuperAdmin(actor) &&
      (!this.isSchoolAdmin(actor) || actor.schoolId !== schoolId)
    ) {
      throw new ForbiddenException(
        'Only Super Admin or the assigned School Admin can manage this school',
      );
    }
  }

  private assertSuperAdmin(actor: { roles: { role: { name: string } }[] }) {
    if (!this.isSuperAdmin(actor)) {
      throw new ForbiddenException('Only Super Admin can create schools');
    }
  }

  private isSuperAdmin(actor: { roles: { role: { name: string } }[] }) {
    return actor.roles.some(({ role }) => role.name === 'Super Admin');
  }

  private isSchoolAdmin(actor: { roles: { role: { name: string } }[] }) {
    return actor.roles.some(({ role }) => role.name === 'School Admin');
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
