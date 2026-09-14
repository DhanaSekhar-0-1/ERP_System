import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { isUUID } from 'class-validator';
import { LoginDto } from './dto/login.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SupabaseAuthService implements OnModuleInit {
  private client!: SupabaseClient;

  private adminClient!: SupabaseClient;

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

    this.client = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    this.adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async getUserFromAccessToken(accessToken: string): Promise<User> {
    const { data, error } = await this.client.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return data.user;
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
      throw new UnauthorizedException(error.message);
    }

    return data;
  }

  async login(input: LoginDto) {
    const email = await this.resolveLoginEmail(input.identifier);
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password: input.password,
    });

    if (error) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return data;
  }

  async refresh(input: RefreshTokenDto) {
    const { data, error } = await this.client.auth.refreshSession({
      refresh_token: input.refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return data;
  }

  async requestPasswordReset(input: PasswordResetDto): Promise<{ sent: true }> {
    const { error } = await this.client.auth.resetPasswordForEmail(input.email);

    if (error) {
      throw new UnauthorizedException('Unable to request password reset');
    }

    return { sent: true };
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
      throw new UnauthorizedException(error?.message ?? 'Unable to create login account');
    }
    return data.user;
  }

  async deleteManagedUser(authUserId: string): Promise<void> {
    const { error } = await this.adminClient.auth.admin.deleteUser(authUserId);
    if (error) {
      throw new InternalServerErrorException('Unable to roll back login account creation');
    }
  }

  private async resolveLoginEmail(identifier: string): Promise<string> {
    const normalized = identifier.trim().toLowerCase();
    if (normalized.includes('@')) {
      return normalized;
    }
    if (!isUUID(normalized)) {
      throw new UnauthorizedException('Invalid student ID or password');
    }
    const student = await this.database.student.findUnique({
      where: { id: normalized },
      select: { user: { select: { email: true } } },
    });
    if (student?.user?.email) {
      return student.user.email;
    }
    const staff = await this.database.staffProfile.findUnique({
      where: { id: normalized },
      select: { user: { select: { email: true } } },
    });
    if (!staff?.user?.email) {
      throw new UnauthorizedException('Invalid student ID or password');
    }
    return staff.user.email;
  }
}
