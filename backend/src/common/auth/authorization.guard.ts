import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from './authorization.service';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';
import { SupabaseUser } from './supabase-user.interface';

interface AuthenticatedRequest {
  user?: SupabaseUser;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
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

    await this.authorization.assertPermissions(
      request.user.id,
      requiredPermissions,
    );
    return true;
  }
}
