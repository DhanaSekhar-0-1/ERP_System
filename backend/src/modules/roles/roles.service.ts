import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { SYSTEM_ROLES } from '../../common/access/roles';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async findMany(authUser: SupabaseUser) {
    await this.getActor(authUser);
    return this.database.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { userRoles: true } },
        permissions: {
          select: { permission: { select: { id: true, code: true, description: true } } },
        },
      },
    });
  }

  async create(authUser: SupabaseUser, input: CreateRoleDto) {
    await this.assertSuperAdmin(authUser);
    try {
      return await this.database.role.create({
        data: {
          name: input.name.trim(),
          description: input.description?.trim(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Role name already exists');
      }
      throw error;
    }
  }

  async findOne(authUser: SupabaseUser, roleId: string) {
    await this.getActor(authUser);
    const role = await this.database.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          select: { permission: { select: { id: true, code: true, description: true } } },
        },
      },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  async update(
    authUser: SupabaseUser,
    roleId: string,
    input: UpdateRoleDto,
  ) {
    await this.assertSuperAdmin(authUser);
    const role = await this.findRole(roleId);
    if (input.name !== undefined && input.name.trim() !== role.name && SYSTEM_ROLES.includes(role.name)) {
      throw new ForbiddenException('Built-in roles cannot be renamed');
    }
    await this.audit.record(await this.access.context(authUser), {
      action: 'role.updated',
      entityType: 'role',
      entityId: roleId,
      oldValue: { name: role.name, description: role.description },
      newValue: input,
    });
    try {
      return await this.database.role.update({
        where: { id: roleId },
        data: {
          name: input.name?.trim(),
          description: input.description?.trim(),
        },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('Role name already exists');
      }
      throw error;
    }
  }

  async findPermissions(authUser: SupabaseUser) {
    await this.getActor(authUser);
    return this.database.permission.findMany({
      orderBy: { code: 'asc' },
    });
  }

  async getPermissions(authUser: SupabaseUser, roleId: string) {
    await this.getActor(authUser);
    await this.findRole(roleId);
    return this.database.rolePermission.findMany({
      where: { roleId },
      orderBy: { permission: { code: 'asc' } },
      select: {
        permission: { select: { id: true, code: true, description: true } },
      },
    });
  }

  async updatePermissions(
    authUser: SupabaseUser,
    roleId: string,
    input: UpdateRolePermissionsDto,
  ) {
    await this.assertSuperAdmin(authUser);
    await this.findRole(roleId);
    const permissionIds = [...new Set(input.permissionIds)];
    const permissions = await this.database.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true },
    });
    if (permissions.length !== permissionIds.length) {
      throw new NotFoundException('One or more permissions were not found');
    }

    const before = await this.database.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
    });
    await this.database.$transaction(async (transaction) => {
      await transaction.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await transaction.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
    });
    const after = await this.getPermissions(authUser, roleId);
    await this.audit.record(await this.access.context(authUser), {
      action: 'role.permissions-replaced',
      entityType: 'role',
      entityId: roleId,
      oldValue: before.map((entry) => entry.permission.code),
      newValue: after.map((entry) => entry.permission.code),
    });
    return after;
  }

  private async findRole(roleId: string) {
    const role = await this.database.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  private async getActor(authUser: SupabaseUser) {
    const actor = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        status: true,
        organizationId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ForbiddenException('Active ERP user profile is required');
    }
    if (!actor.organizationId) {
      throw new ForbiddenException('Administrator must belong to an organization');
    }
    if (
      !actor.roles.some(
        ({ role }) => role.name === 'Super Admin' || role.name === 'School Admin',
      )
    ) {
      throw new ForbiddenException('Organization or school administration access is required');
    }
    return actor;
  }

  private async assertSuperAdmin(authUser: SupabaseUser) {
    const actor = await this.getActor(authUser);
    if (!actor.roles.some(({ role }) => role.name === 'Super Admin')) {
      throw new ForbiddenException('Only Super Admin can manage roles');
    }
    return actor;
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
