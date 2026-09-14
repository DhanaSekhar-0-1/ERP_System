import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateSchoolDto } from '../schools/dto/create-school.dto';
import { SchoolsService } from '../schools/schools.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly schools: SchoolsService,
  ) {}

  async findMany(authUser: SupabaseUser) {
    const actor = await this.getActor(authUser);
    this.assertPermissionScope(actor, false);
    return this.database.organization.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { schools: true } } },
    });
  }

  async create(authUser: SupabaseUser, input: CreateOrganizationDto) {
    const actor = await this.getActor(authUser);
    this.assertPermissionScope(actor, true);
    try {
      return await this.database.organization.create({
        data: { name: input.name.trim(), slug: input.slug.trim().toLowerCase() },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Organization slug already exists');
      }
      throw error;
    }
  }

  async findOne(authUser: SupabaseUser, organizationId: string) {
    const actor = await this.getActor(authUser);
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      include: { _count: { select: { schools: true } } },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    this.assertOrganizationReadScope(actor, organizationId);
    return organization;
  }

  async update(
    authUser: SupabaseUser,
    organizationId: string,
    input: UpdateOrganizationDto,
  ) {
    const actor = await this.getActor(authUser);
    this.assertPermissionScope(actor, true);
    await this.findOrganization(organizationId);
    try {
      return await this.database.organization.update({
        where: { id: organizationId },
        data: {
          name: input.name === undefined ? undefined : input.name.trim(),
          slug:
            input.slug === undefined ? undefined : input.slug.trim().toLowerCase(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Organization slug already exists');
      }
      throw error;
    }
  }

  findSchools(
    authUser: SupabaseUser,
    organizationId: string,
  ) {
    return this.schools.findForOrganization(authUser, organizationId);
  }

  createSchool(
    authUser: SupabaseUser,
    organizationId: string,
    input: CreateSchoolDto,
  ) {
    return this.schools.createForOrganization(authUser, organizationId, input);
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

  private assertPermissionScope(
    actor: {
      organizationId: string | null;
      schoolId: string | null;
      roles: { role: { name: string } }[];
    },
    manage: boolean,
  ) {
    if (!this.isSuperAdmin(actor)) {
      throw new ForbiddenException(
        manage
          ? 'Only Super Admin can manage organizations'
          : 'Organization access is restricted to Super Admin',
      );
    }
  }

  private assertOrganizationReadScope(
    actor: {
      organizationId: string | null;
      schoolId: string | null;
      roles: { role: { name: string } }[];
    },
    organizationId: string,
  ) {
    if (
      !this.isSuperAdmin(actor) &&
      (!actor.schoolId || actor.organizationId !== organizationId)
    ) {
      throw new ForbiddenException('Organization access is not permitted');
    }
  }

  private isSuperAdmin(actor: { roles: { role: { name: string } }[] }) {
    return actor.roles.some(({ role }) => role.name === 'Super Admin');
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
