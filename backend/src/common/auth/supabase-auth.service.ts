import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { isUUID } from 'class-validator';
import { LoginDto } from './dto/login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { DatabaseService } from '../database/database.service';
import { currentRequest } from '../http/request-context';

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ACCOUNT_FAILURES = 5;
const MAX_IP_FAILURES = 30;

@Injectable()
export class SupabaseAuthService implements OnModuleInit {
  private client!: SupabaseClient;

  private adminClient!: SupabaseClient;

  private url!: string;

  private anonKey!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit(): void {
    const url = this.config.get<string>('SUPABASE_URL');
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY');
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !anonKey || !serviceRoleKey) {
      throw new InternalServerErrorException(
        'Supabase URL, anon key, and server-only service role key must be configured',
      );
    }

    this.url = url;
    this.anonKey = anonKey;
    this.client = this.createAnonClient();
    this.adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  get storage() {
    return this.adminClient.storage;
  }

  async getUserFromAccessToken(accessToken: string): Promise<User> {
    const { data, error } = await this.client.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return data.user;
  }

  /** Reads the session_id claim from an access token already verified by Supabase. */
  sessionIdFromToken(accessToken: string): string | undefined {
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
      ) as { session_id?: unknown };
      return typeof payload.session_id === 'string' ? payload.session_id : undefined;
    } catch {
      return undefined;
    }
  }

  async register(input: RegisterDto) {
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { full_name: input.fullName },
      },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data;
  }

  async login(input: LoginDto) {
    const identifier = input.identifier.trim().toLowerCase();
    await this.assertNotLockedOut(identifier);
    let email: string;
    try {
      email = await this.resolveLoginEmail(identifier);
    } catch (error) {
      await this.recordAttempt(identifier, false);
      throw error;
    }
    const client = this.createAnonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: input.password,
    });

    if (error || !data.session) {
      await this.recordAttempt(identifier, false);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.recordAttempt(identifier, true);
    await this.recordSession(data.session);
    return data;
  }

  async refresh(input: RefreshTokenDto) {
    const client = this.createAnonClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: input.refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const sessionId = this.sessionIdFromToken(data.session.access_token);
    if (sessionId) {
      const known = await this.database.userSession.findUnique({ where: { sessionId } });
      if (known?.revokedAt) {
        throw new UnauthorizedException('This session has been signed out');
      }
    }
    await this.recordSession(data.session);
    return data;
  }

  async requestPasswordReset(input: PasswordResetDto): Promise<{ sent: true }> {
    const { error } = await this.client.auth.resetPasswordForEmail(input.email);

    if (error) {
      throw new BadRequestException('Unable to request password reset');
    }

    return { sent: true };
  }

  /** Completes a reset using the recovery access token from the emailed link. */
  async resetPassword(recoveryToken: string, newPassword: string) {
    const user = await this.getUserFromAccessToken(recoveryToken);
    await this.setPassword(user.id, newPassword);
    await this.revokeAllSessions(user.id);
    return { reset: true };
  }

  async changePassword(
    authUserId: string,
    email: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const client = this.createAnonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: currentPassword });
    if (error) {
      throw new BadRequestException('Current password is incorrect');
    }
    await client.auth.signOut();
    await this.setPassword(authUserId, newPassword);
    return { changed: true };
  }

  async sendOtp(email: string) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      throw new BadRequestException('Unable to send a one-time code');
    }
    return { sent: true };
  }

  async verifyOtp(email: string, token: string, type: 'email' | 'signup' = 'email') {
    const client = this.createAnonClient();
    const { data, error } = await client.auth.verifyOtp({ email, token, type });
    if (error || !data.session) {
      await this.recordAttempt(email.toLowerCase(), false);
      throw new UnauthorizedException('Invalid or expired code');
    }
    await this.recordSession(data.session);
    return data;
  }

  /** Signs out the given access token's session (local) or every session (global). */
  async signOut(accessToken: string, scope: 'local' | 'global') {
    const { error } = await this.adminClient.auth.admin.signOut(accessToken, scope);
    if (error) {
      throw new BadRequestException('Unable to sign out');
    }
  }

  async mfaEnroll(accessToken: string, friendlyName?: string) {
    return this.authFetch(accessToken, 'POST', '/factors', {
      factor_type: 'totp',
      friendly_name: friendlyName ?? `ERP ${new Date().toISOString().slice(0, 10)}`,
    });
  }

  async mfaVerify(accessToken: string, factorId: string, code: string) {
    const challenge = (await this.authFetch(
      accessToken,
      'POST',
      `/factors/${factorId}/challenge`,
      {},
    )) as { id: string };
    return this.authFetch(accessToken, 'POST', `/factors/${factorId}/verify`, {
      challenge_id: challenge.id,
      code,
    });
  }

  async mfaUnenroll(accessToken: string, factorId: string) {
    await this.authFetch(accessToken, 'DELETE', `/factors/${factorId}`);
    return { disabled: true };
  }

  async createManagedUser(input: {
    email: string;
    password: string;
    displayName: string;
  }) {
    const { data, error } = await this.adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.displayName },
    });
    if (error || !data.user) {
      throw new BadRequestException(error?.message ?? 'Unable to create login account');
    }
    return data.user;
  }

  async inviteManagedUser(input: {
    email: string;
    displayName: string;
  }) {
    const { data, error } = await this.adminClient.auth.admin.inviteUserByEmail(
      input.email,
      { data: { full_name: input.displayName } },
    );
    if (error || !data.user) {
      throw new BadRequestException(
        error?.message ?? 'Unable to send the invitation',
      );
    }
    return data.user;
  }

  async getManagedUser(authUserId: string) {
    const { data, error } = await this.adminClient.auth.admin.getUserById(authUserId);
    if (error || !data.user) {
      throw new NotFoundException('Login account not found');
    }
    return data.user;
  }

  async updateManagedUser(
    authUserId: string,
    input: { email?: string; displayName?: string },
  ) {
    const { data, error } = await this.adminClient.auth.admin.updateUserById(
      authUserId,
      {
        email: input.email,
        email_confirm: input.email === undefined ? undefined : true,
        user_metadata:
          input.displayName === undefined
            ? undefined
            : { full_name: input.displayName },
      },
    );
    if (error || !data.user) {
      throw new BadRequestException(
        error?.message ?? 'Unable to update the login account',
      );
    }
    return data.user;
  }

  async deleteManagedUser(authUserId: string): Promise<void> {
    const { error } = await this.adminClient.auth.admin.deleteUser(authUserId);
    if (error) {
      throw new InternalServerErrorException('Unable to roll back login account creation');
    }
  }

  async revokeAllSessions(authUserId: string) {
    const user = await this.database.user.findUnique({
      where: { authUserId },
      select: { id: true },
    });
    if (user) {
      await this.database.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  private async setPassword(authUserId: string, password: string) {
    const { error } = await this.adminClient.auth.admin.updateUserById(authUserId, { password });
    if (error) {
      throw new BadRequestException(error.message);
    }
  }

  private async recordSession(session: Session) {
    const sessionId = this.sessionIdFromToken(session.access_token);
    if (!sessionId) return;
    const user = await this.database.user.findUnique({
      where: { authUserId: session.user.id },
      select: { id: true },
    });
    if (!user) return;
    const request = currentRequest();
    await this.database.userSession.upsert({
      where: { sessionId },
      create: {
        sessionId,
        userId: user.id,
        ipAddress: request?.ipAddress,
        userAgent: request?.userAgent,
      },
      update: { lastSeenAt: new Date() },
    });
  }

  private async assertNotLockedOut(identifier: string) {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const ipAddress = currentRequest()?.ipAddress;
    const [accountFailures, ipFailures] = await Promise.all([
      this.database.loginAttempt.count({
        where: { identifier, success: false, createdAt: { gte: since } },
      }),
      ipAddress
        ? this.database.loginAttempt.count({
            where: { ipAddress, success: false, createdAt: { gte: since } },
          })
        : Promise.resolve(0),
    ]);
    if (accountFailures >= MAX_ACCOUNT_FAILURES || ipFailures >= MAX_IP_FAILURES) {
      await this.database.securityEvent.create({
        data: {
          type: 'login.lockout',
          severity: 'MEDIUM',
          description: `Login blocked after repeated failures for ${identifier}`,
          ipAddress,
          metadata: { accountFailures, ipFailures },
        },
      });
      throw new HttpException(
        'Too many failed sign-in attempts. Try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordAttempt(identifier: string, success: boolean) {
    await this.database.loginAttempt.create({
      data: { identifier, success, ipAddress: currentRequest()?.ipAddress },
    });
  }

  private async authFetch(
    accessToken: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch(`${this.url}/auth/v1${path}`, {
      method,
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message =
        (parsed as { msg?: string; message?: string }).msg ??
        (parsed as { message?: string }).message ??
        'Authentication request failed';
      throw new BadRequestException(message);
    }
    return parsed;
  }

  private createAnonClient(): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  private async resolveLoginEmail(identifier: string): Promise<string> {
    if (identifier.includes('@')) {
      return identifier;
    }
    if (!isUUID(identifier)) {
      throw new UnauthorizedException('Invalid student ID or password');
    }
    const student = await this.database.student.findUnique({
      where: { id: identifier },
      select: { user: { select: { email: true } } },
    });
    if (student?.user?.email) {
      return student.user.email;
    }
    const staff = await this.database.staffProfile.findUnique({
      where: { id: identifier },
      select: { user: { select: { email: true } } },
    });
    if (!staff?.user?.email) {
      throw new UnauthorizedException('Invalid student ID or password');
    }
    return staff.user.email;
  }
}
