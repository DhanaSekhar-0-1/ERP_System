import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';

@Injectable()
export class PermissionsService {
  constructor(private readonly database: DatabaseService) {}

  async findMany(authUser: SupabaseUser) {
    const actor = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        status: true,
        organizationId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (
      !actor ||
      actor.status !== 'ACTIVE' ||
      !actor.organizationId ||
      !actor.roles.some(
        ({ role }) => role.name === 'Super Admin' || role.name === 'School Admin',
      )
    ) {
      throw new ForbiddenException('Organization or school administration access is required');
    }
    return this.database.permission.findMany({ orderBy: { code: 'asc' } });
  }
}
