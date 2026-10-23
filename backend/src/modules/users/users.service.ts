import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AssignUserRoleDto } from './dto/assign-user-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreatePermissionOverrideDto } from './dto/permission-override.dto';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async findMany(authUser: SupabaseUser) {
    const actor = await this.getActor(authUser);
    return this.database.user.findMany({
      where: this.scopeWhere(actor),
      orderBy: { displayName: 'asc' },
      select: this.userSelect,
    });
  }

  async create(authUser: SupabaseUser, input: CreateUserDto) {
    const actor = await this.getActor(authUser);
    const scope = await this.resolveScope(actor, input.organizationId, input.schoolId);
    await this.assertRolesCanBeAssigned(actor, input.roleIds ?? []);

    let managedAuthUserId = input.authUserId;
    let createdManagedAuthUser = false;
    if (!managedAuthUserId) {
      const managedAuthUser = input.password
        ? await this.supabaseAuth.createManagedUser({
            email: input.email.trim().toLowerCase(),
            password: input.password,
            displayName: input.displayName.trim(),
          })
        : await this.supabaseAuth.inviteManagedUser({
            email: input.email.trim().toLowerCase(),
            displayName: input.displayName.trim(),
          });
      managedAuthUserId = managedAuthUser.id;
      createdManagedAuthUser = true;
    }

    try {
      return await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            authUserId: managedAuthUserId as string,
            email: input.email.trim().toLowerCase(),
            displayName: input.displayName.trim(),
            organizationId: scope.organizationId,
            schoolId: scope.schoolId,
            status: 'INVITED',
          },
        });

        if (input.roleIds?.length) {
          await transaction.userRole.createMany({
            data: input.roleIds.map((roleId) => ({ userId: user.id, roleId })),
            skipDuplicates: true,
          });
        }

        return transaction.user.findUniqueOrThrow({
          where: { id: user.id },
          select: this.userSelect,
        });
      });
    } catch (error) {
      if (createdManagedAuthUser) {
        await this.supabaseAuth.deleteManagedUser(managedAuthUserId);
      }
      if (this.isUniqueError(error)) {
        throw new ConflictException('A user with this email or login account already exists');
      }
      throw error;
    }
  }

  async findOne(authUser: SupabaseUser, userId: string) {
    const actor = await this.getActor(authUser);
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: this.userSelect,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.assertInScope(actor, user.organizationId, user.schoolId);
    return user;
  }

  async update(
    authUser: SupabaseUser,
    userId: string,
    input: UpdateUserDto,
  ) {
    const actor = await this.getActor(authUser);
    const existing = await this.getScopedUser(actor, userId);
    const scope = await this.resolveScope(
      actor,
      input.organizationId ?? existing.organizationId ?? undefined,
      input.schoolId === undefined ? existing.schoolId ?? undefined : input.schoolId,
    );

    const email = input.email?.trim().toLowerCase();
    const displayName = input.displayName?.trim();
    try {
      const updated = await this.database.user.update({
        where: { id: existing.id },
        data: {
          email,
          displayName,
          organizationId: scope.organizationId,
          schoolId: scope.schoolId,
        },
        select: this.userSelect,
      });
      if ((email && email !== existing.email) || (displayName && displayName !== existing.displayName)) {
        await this.supabaseAuth.updateManagedUser(existing.authUserId, {
          email: email && email !== existing.email ? email : undefined,
          displayName,
        });
      }
      await this.record(authUser, 'user.updated', existing.id, {
        oldValue: { email: existing.email, displayName: existing.displayName, schoolId: existing.schoolId },
        newValue: input,
      });
      return updated;
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async activate(authUser: SupabaseUser, userId: string) {
    const actor = await this.getActor(authUser);
    const existing = await this.getScopedUser(actor, userId);
    const user = await this.database.user.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE' },
      select: this.userSelect,
    });
    await this.record(authUser, 'user.activated', existing.id, {
      oldValue: { status: existing.status },
      newValue: { status: 'ACTIVE' },
    });
    return user;
  }

  async deactivate(authUser: SupabaseUser, userId: string) {
    const actor = await this.getActor(authUser);
    const existing = await this.getScopedUser(actor, userId);
    if (existing.id === actor.id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const user = await this.database.$transaction(async (transaction) => {
      await this.assertNotLastActiveSchoolAdmin(transaction, existing);
      await transaction.userSession.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return transaction.user.update({
        where: { id: existing.id },
        data: { status: 'SUSPENDED' },
        select: this.userSelect,
      });
    });
    await this.record(authUser, 'user.deactivated', existing.id, {
      oldValue: { status: existing.status },
      newValue: { status: 'SUSPENDED' },
    });
    return user;
  }

  async getOverrides(authUser: SupabaseUser, userId: string) {
    const actor = await this.getActor(authUser);
    const user = await this.getScopedUser(actor, userId);
    return this.database.permissionOverride.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { permission: { select: { id: true, code: true, description: true } } },
    });
  }

  async addOverride(authUser: SupabaseUser, userId: string, input: CreatePermissionOverrideDto) {
    const actor = await this.getActor(authUser);
    const user = await this.getScopedUser(actor, userId);
    const permission = await this.database.permission.findUnique({
      where: { code: input.permissionCode },
    });
    if (!permission) {
      throw new NotFoundException('Permission not found');
    }
    if (!this.isSuperAdmin(actor) && permission.code.startsWith('organizations:')) {
      throw new ForbiddenException('School Admin cannot grant organization permissions');
    }
    const override = await this.database.permissionOverride.upsert({
      where: { userId_permissionId: { userId: user.id, permissionId: permission.id } },
      create: {
        userId: user.id,
        permissionId: permission.id,
        effect: input.effect,
        reason: input.reason,
        createdById: actor.id,
      },
      update: { effect: input.effect, reason: input.reason, createdById: actor.id },
      include: { permission: { select: { id: true, code: true } } },
    });
    await this.record(authUser, 'permission-override.set', user.id, {
      newValue: { permission: permission.code, effect: input.effect },
      reason: input.reason,
    });
    return override;
  }

  async removeOverride(authUser: SupabaseUser, userId: string, overrideId: string) {
    const actor = await this.getActor(authUser);
    const user = await this.getScopedUser(actor, userId);
    const override = await this.database.permissionOverride.findFirst({
      where: { id: overrideId, userId: user.id },
      include: { permission: { select: { code: true } } },
    });
    if (!override) {
      throw new NotFoundException('Permission override not found');
    }
    await this.database.permissionOverride.delete({ where: { id: override.id } });
    await this.record(authUser, 'permission-override.removed', user.id, {
      oldValue: { permission: override.permission.code, effect: override.effect },
    });
    return { id: override.id, removed: true };
  }

  private async record(
    authUser: SupabaseUser,
    action: string,
    userId: string,
    extra: { oldValue?: unknown; newValue?: unknown; reason?: string },
  ) {
    const context = await this.access.context(authUser);
    await this.audit.record(context, { action, entityType: 'user', entityId: userId, ...extra });
  }

  async invite(authUser: SupabaseUser, userId: string) {
    const actor = await this.getActor(authUser);
    const existing = await this.getScopedUser(actor, userId);
    await this.supabaseAuth.inviteManagedUser({
      email: existing.email,
      displayName: existing.displayName,
    });
    return this.database.user.update({
      where: { id: existing.id },
      data: { status: 'INVITED' },
      select: this.userSelect,
    });
  }

  async resendInvite(authUser: SupabaseUser, userId: string) {
    return this.invite(authUser, userId);
  }

  async getRoles(authUser: SupabaseUser, userId: string) {
    const actor = await this.getActor(authUser);
    const user = await this.getScopedUser(actor, userId);
    return this.database.userRole.findMany({
      where: { userId: user.id },
      orderBy: { role: { name: 'asc' } },
      select: {
        role: {
          select: { id: true, name: true, description: true },
        },
      },
    });
  }

  async assignRole(
    authUser: SupabaseUser,
    userId: string,
    input: AssignUserRoleDto,
  ) {
    const actor = await this.getActor(authUser);
    const user = await this.getScopedUser(actor, userId);
    await this.assertRolesCanBeAssigned(actor, [input.roleId]);
    const role = await this.database.role.findUnique({
      where: { id: input.roleId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    try {
      await this.database.userRole.create({
        data: { userId: user.id, roleId: role.id },
      });
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('User already has this role');
      }
      throw error;
    }
    await this.record(authUser, 'user.role-assigned', user.id, { newValue: { role: role.name } });
    return { userId: user.id, role };
  }

  async removeRole(authUser: SupabaseUser, userId: string, roleId: string) {
    const actor = await this.getActor(authUser);
    const user = await this.getScopedUser(actor, userId);
    const role = await this.database.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.name === 'School Admin') {
      await this.assertNotLastActiveSchoolAdmin(this.database, user);
    }
    await this.database.userRole.delete({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
    }).catch((error: unknown) => {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('User does not have this role');
      }
      throw error;
    });
    await this.record(authUser, 'user.role-removed', user.id, { oldValue: { role: role.name } });
    return { userId: user.id, roleId: role.id, removed: true };
  }

  private readonly userSelect = {
    id: true,
    authUserId: true,
    email: true,
    displayName: true,
    status: true,
    organizationId: true,
    schoolId: true,
    createdAt: true,
    updatedAt: true,
    roles: {
      select: {
        role: { select: { id: true, name: true, description: true } },
      },
    },
  } as const;

  private async getActor(authUser: SupabaseUser) {
    const actor = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        id: true,
        status: true,
        organizationId: true,
        schoolId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ForbiddenException('Active ERP user profile is required');
    }
    if (!this.isSuperAdmin(actor) && !this.isSchoolAdmin(actor)) {
      throw new ForbiddenException('Organization or school administration access is required');
    }
    if (this.isSchoolAdmin(actor) && !actor.schoolId) {
      throw new ForbiddenException('School Admin must be assigned to a school');
    }
    return actor;
  }

  private async getScopedUser(
    actor: Awaited<ReturnType<UsersService['getActor']>>,
    userId: string,
  ) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: this.userSelect,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.assertInScope(actor, user.organizationId, user.schoolId);
    return user;
  }

  private async resolveScope(
    actor: Awaited<ReturnType<UsersService['getActor']>>,
    organizationId?: string,
    schoolId?: string,
  ) {
    if (!actor.organizationId) {
      throw new ForbiddenException('Administrator must belong to an organization');
    }
    if (!this.isSuperAdmin(actor)) {
      if (
        actor.organizationId !== organizationId ||
        actor.schoolId !== schoolId
      ) {
        throw new ForbiddenException('School administrator scope is restricted to the assigned school');
      }
    }
    const targetOrganizationId = organizationId ?? actor.organizationId;
    if (targetOrganizationId !== actor.organizationId) {
      throw new ForbiddenException('Organization access is not permitted');
    }
    if (schoolId) {
      const school = await this.database.school.findUnique({
        where: { id: schoolId },
        select: { organizationId: true },
      });
      if (!school || school.organizationId !== targetOrganizationId) {
        throw new BadRequestException('School does not belong to the selected organization');
      }
    }
    return { organizationId: targetOrganizationId, schoolId: schoolId ?? null };
  }

  private scopeWhere(actor: Awaited<ReturnType<UsersService['getActor']>>) {
    if (!actor.organizationId) {
      throw new ForbiddenException('Administrator must belong to an organization');
    }
    return this.isSuperAdmin(actor)
      ? { organizationId: actor.organizationId }
      : { organizationId: actor.organizationId, schoolId: actor.schoolId as string };
  }

  private assertInScope(
    actor: Awaited<ReturnType<UsersService['getActor']>>,
    organizationId: string | null,
    schoolId: string | null,
  ) {
    const permitted =
      this.isSuperAdmin(actor)
        ? organizationId === actor.organizationId
        : organizationId === actor.organizationId && schoolId === actor.schoolId;
    if (!permitted) {
      throw new ForbiddenException('User access is not permitted');
    }
  }

  private async assertRolesCanBeAssigned(
    actor: Awaited<ReturnType<UsersService['getActor']>>,
    roleIds: string[],
  ) {
    if (!roleIds.length) return;
    const roles = await this.database.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });
    if (roles.length !== new Set(roleIds).size) {
      throw new NotFoundException('One or more roles were not found');
    }
    if (!this.isSuperAdmin(actor) && roles.some((role) => role.name === 'Super Admin')) {
      throw new ForbiddenException('School Admin cannot assign the Super Admin role');
    }
  }

  private async assertNotLastActiveSchoolAdmin(
    database: Pick<DatabaseService, 'user'>,
    user: { schoolId: string | null; status: string; roles: { role: { name: string } }[] },
  ) {
    if (
      user.status !== 'ACTIVE' ||
      !user.schoolId ||
      !user.roles.some(({ role }) => role.name === 'School Admin')
    ) {
      return;
    }
    const activeAdmins = await database.user.count({
      where: {
        schoolId: user.schoolId,
        status: 'ACTIVE',
        roles: { some: { role: { name: 'School Admin' } } },
      },
    });
    if (activeAdmins <= 1) {
      throw new BadRequestException('The last active School Admin cannot be deactivated or removed');
    }
  }

  private isSuperAdmin(actor: { roles: { role: { name: string } }[] }) {
    return actor.roles.some(({ role }) => role.name === 'Super Admin');
  }

  private isSchoolAdmin(actor: { roles: { role: { name: string } }[] }) {
    return actor.roles.some(({ role }) => role.name === 'School Admin');
  }

  private isUniqueError(error: unknown): boolean {
    return this.isPrismaError(error, 'P2002');
  }

  private isRecordNotFoundError(error: unknown): boolean {
    return this.isPrismaError(error, 'P2025');
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}
