import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from './common/auth/current-user.decorator';
import { RequirePermissions } from './common/auth/permissions.decorator';
import { Public } from './common/auth/public.decorator';
import { SupabaseUser } from './common/auth/supabase-user.interface';
import { DatabaseService } from './common/database/database.service';

@Controller()
export class AppController {
  constructor(private readonly database: DatabaseService) {}

  @Get('health')
  @Public()
  async health(): Promise<{ status: string; database: string }> {
    await this.database.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok' };
  }

  @Get('auth-test')
  authTest(@CurrentUser() user: SupabaseUser): {
    authenticated: boolean;
    userId: string;
    email?: string;
  } {
    return {
      authenticated: true,
      userId: user.id,
      email: user.email,
    };
  }

  @Get('authorization-test')
  @RequirePermissions('system:authorization:test')
  authorizationTest(): { authorized: boolean } {
    return { authorized: true };
  }
}
