import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AuthorizationService {
  constructor(private readonly database: DatabaseService) {}

  async assertPermissions(
    authUserId: string,
    requiredPermissions: string[],
  ): Promise<void> {
    if (requiredPermissions.length === 0) {
      return;
    }

    const user = await this.database.user.findUnique({
      where: { authUserId },
      select: {
        id: true,
        status: true,
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: {
                    permission: {
                      select: { code: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('ERP user profile was not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('ERP user is not active');
    }

    const grantedPermissions = new Set(
      user.roles.flatMap((userRole) =>
        userRole.role.permissions.map(
          (rolePermission) => rolePermission.permission.code,
        ),
      ),
    );

    const hasAllPermissions = requiredPermissions.every((permission) =>
      grantedPermissions.has(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException('Required permission is missing');
    }
  }
}
