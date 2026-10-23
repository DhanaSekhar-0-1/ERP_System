import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { SupabaseUser } from './supabase-user.interface';
import { AuthService, ErpUserProfile } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { LoginDto } from './dto/login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ChangePasswordDto,
  MfaDisableDto,
  MfaSetupDto,
  MfaVerifyDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/account.dto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
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

  @Post('forgot-password')
  @Public()
  async forgotPassword(@Body() input: PasswordResetDto) {
    return this.supabaseAuth.requestPasswordReset(input);
  }

  @Post('reset-password')
  @Public()
  async resetPassword(@Body() input: ResetPasswordDto) {
    return this.supabaseAuth.resetPassword(input.recoveryToken, input.newPassword);
  }

  @Post('send-otp')
  @Public()
  async sendOtp(@Body() input: SendOtpDto) {
    return this.supabaseAuth.sendOtp(input.email);
  }

  @Post('verify-otp')
  @Public()
  async verifyOtp(@Body() input: VerifyOtpDto) {
    return this.supabaseAuth.verifyOtp(input.email, input.token, input.type ?? 'email');
  }

  @Post('verify-email')
  @Public()
  async verifyEmail(@Body() input: VerifyOtpDto) {
    return this.supabaseAuth.verifyOtp(input.email, input.token, input.type ?? 'signup');
  }

  @Get('me')
  async me(@CurrentUser() user: SupabaseUser): Promise<{
    supabaseUser: SupabaseUser;
    erpUser: ErpUserProfile;
  }> {
    const erpUser = await this.auth.syncUser(user);
    const { accessToken: _token, ...supabaseUser } = user;
    return {
      supabaseUser,
      erpUser,
    };
  }

  @Post('logout')
  async logout(@CurrentUser() user: SupabaseUser) {
    if (user.accessToken) {
      await this.supabaseAuth.signOut(user.accessToken, 'local');
    }
    if (user.sessionId) {
      await this.database.userSession.updateMany({
        where: { sessionId: user.sessionId },
        data: { revokedAt: new Date() },
      });
    }
    return { loggedOut: true };
  }

  @Post('change-password')
  async changePassword(@CurrentUser() user: SupabaseUser, @Body() input: ChangePasswordDto) {
    if (!user.email) {
      throw new BadRequestException('This account has no email address');
    }
    const result = await this.supabaseAuth.changePassword(
      user.id,
      user.email,
      input.currentPassword,
      input.newPassword,
    );
    const erpUser = await this.erpUser(user);
    await this.audit.record(null, {
      action: 'auth.password-changed',
      entityType: 'user',
      entityId: erpUser.id,
      schoolId: erpUser.schoolId,
    });
    return result;
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: SupabaseUser) {
    const erpUser = await this.erpUser(user);
    const sessions = await this.database.userSession.findMany({
      where: { userId: erpUser.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        sessionId: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.sessionId === user.sessionId,
    }));
  }

  @Delete('sessions/all')
  async revokeAllSessions(@CurrentUser() user: SupabaseUser) {
    if (user.accessToken) {
      await this.supabaseAuth.signOut(user.accessToken, 'global');
    }
    await this.supabaseAuth.revokeAllSessions(user.id);
    return { revoked: true };
  }

  @Delete('sessions/:sessionId')
  async revokeSession(@CurrentUser() user: SupabaseUser, @Param('sessionId') sessionId: string) {
    const erpUser = await this.erpUser(user);
    const result = await this.database.userSession.updateMany({
      where: { sessionId, userId: erpUser.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) {
      throw new NotFoundException('Session not found');
    }
    return { revoked: true, sessionId };
  }

  @Post('mfa/setup')
  async mfaSetup(@CurrentUser() user: SupabaseUser, @Body() input: MfaSetupDto) {
    return this.supabaseAuth.mfaEnroll(this.token(user), input.friendlyName);
  }

  @Post('mfa/verify')
  async mfaVerify(@CurrentUser() user: SupabaseUser, @Body() input: MfaVerifyDto) {
    return this.supabaseAuth.mfaVerify(this.token(user), input.factorId, input.code);
  }

  @Post('mfa/disable')
  async mfaDisable(@CurrentUser() user: SupabaseUser, @Body() input: MfaDisableDto) {
    return this.supabaseAuth.mfaUnenroll(this.token(user), input.factorId);
  }

  private token(user: SupabaseUser): string {
    if (!user.accessToken) {
      throw new ForbiddenException('An access token is required');
    }
    return user.accessToken;
  }

  private async erpUser(user: SupabaseUser) {
    const erpUser = await this.database.user.findUnique({
      where: { authUserId: user.id },
      select: { id: true, schoolId: true },
    });
    if (!erpUser) {
      throw new ForbiddenException('ERP user profile is required');
    }
    return erpUser;
  }
}
