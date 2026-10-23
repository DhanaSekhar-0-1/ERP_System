import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../access/access.service';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';
import { SupabaseUser } from './supabase-user.interface';

interface AuthenticatedRequest {
  user?: SupabaseUser;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRED_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    if (requiredPermissions.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new Error('Authorization guard requires an authenticated user');
    }

    const actor = await this.access.context(request.user);
    const hasAllPermissions = requiredPermissions.every((permission) =>
      actor.permissions.has(permission),
    );
    if (!hasAllPermissions) {
      throw new ForbiddenException('Required permission is missing');
    }
    return true;
  }
}
