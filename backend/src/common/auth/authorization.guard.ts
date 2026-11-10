import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../access/access.service';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_BEFORE_PASSWORD_CHANGE_KEY } from './password-change.decorator';
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
    await this.assertPasswordChanged(context);
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

  /**
   * A user on a generated first password may only reach routes marked
   * @AllowBeforePasswordChange (who am I, change password, sign out). This is what keeps the
   * guessable first password safe, so it cannot be skipped by calling other routes directly.
   */
  private async assertPasswordChanged(context: ExecutionContext): Promise<void> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(ALLOW_BEFORE_PASSWORD_CHANGE_KEY, targets)
    ) {
      return;
    }
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) return;
    let mustChange = false;
    try {
      mustChange = (await this.access.context(user)).mustChangePassword;
    } catch {
      // No usable ERP profile: the route's own checks decide.
      return;
    }
    if (mustChange) {
      throw new ForbiddenException('Change your first password before continuing');
    }
  }
}
