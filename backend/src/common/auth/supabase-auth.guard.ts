import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthService } from './supabase-auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SupabaseUser } from './supabase-user.interface';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: SupabaseUser;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: SupabaseAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const accessToken = this.extractBearerToken(authorization);

    if (!accessToken) {
      throw new UnauthorizedException('Bearer access token is required');
    }

    const user = await this.auth.getUserFromAccessToken(accessToken);
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      appMetadata: user.app_metadata,
      userMetadata: user.user_metadata,
    };
    return true;
  }

  private extractBearerToken(
    authorization: string | string[] | undefined,
  ): string | undefined {
    if (typeof authorization !== 'string') {
      return undefined;
    }

    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    return match?.[1];
  }
}
