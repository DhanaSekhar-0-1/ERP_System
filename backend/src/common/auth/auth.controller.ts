import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { SupabaseUser } from './supabase-user.interface';
import { AuthService, ErpUserProfile } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { LoginDto } from './dto/login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly supabaseAuth: SupabaseAuthService,
  ) {}

  @Post('register')
  @Public()
  async register(@Body() input: RegisterDto) {
    return this.supabaseAuth.register(input);
  }

  @Post('login')
  @Public()
  async login(@Body() input: LoginDto) {
    return this.supabaseAuth.login(input);
  }

  @Post('refresh')
  @Public()
  async refresh(@Body() input: RefreshTokenDto) {
    return this.supabaseAuth.refresh(input);
  }

  @Post('password-reset/request')
  @Public()
  async requestPasswordReset(@Body() input: PasswordResetDto) {
    return this.supabaseAuth.requestPasswordReset(input);
  }

  @Get('me')
  async me(@CurrentUser() user: SupabaseUser): Promise<{
    supabaseUser: SupabaseUser;
    erpUser: ErpUserProfile;
  }> {
    const erpUser = await this.auth.syncUser(user);
    return {
      supabaseUser: user,
      erpUser,
    };
  }
}
