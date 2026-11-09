import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AccessService } from './access.service';

/** Routes whose changes can alter someone's roles, permissions, account status or school. */
const ACCESS_ROUTES = /\/(users|roles|staff|schools|organizations|guardians\/[^/]+\/account)(\/|$|\?)/;

/**
 * Clears the cached roles and permissions after any successful change to users, roles, staff,
 * schools or organizations, so those changes apply on the very next request.
 */
@Injectable()
export class AccessCacheInterceptor implements NestInterceptor {
  constructor(private readonly access: AccessService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const changes = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
    const path = request.originalUrl ?? request.url ?? '';
    if (!changes || !ACCESS_ROUTES.test(path)) {
      return next.handle();
    }
    return next.handle().pipe(tap(() => this.access.invalidate()));
  }
}
