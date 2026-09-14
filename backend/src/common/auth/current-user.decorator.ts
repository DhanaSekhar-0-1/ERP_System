import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SupabaseUser } from './supabase-user.interface';

interface AuthenticatedRequest {
  user?: SupabaseUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SupabaseUser => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new Error('Authenticated user is missing from the request');
    }

    return request.user;
  },
);
