import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SupabaseUser } from './supabase-user.interface';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: SupabaseUser;
}

const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: SupabaseAuthService,
    private readonly database: DatabaseService,
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
    const sessionId = this.auth.sessionIdFromToken(accessToken);
    if (sessionId) {
      await this.assertSessionActive(sessionId);
    }
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      appMetadata: user.app_metadata,
      userMetadata: user.user_metadata,
      sessionId,
      accessToken,
    };
    return true;
  }

  private async assertSessionActive(sessionId: string): Promise<void> {
    const session = await this.database.userSession.findUnique({
      where: { sessionId },
      select: { id: true, revokedAt: true, lastSeenAt: true },
    });
    if (session?.revokedAt) {
      throw new UnauthorizedException('This session has been signed out');
    }
    if (session && Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
      await this.database.userSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
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
