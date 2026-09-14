import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SupabaseUser } from './supabase-user.interface';

export interface ErpUserProfile {
  id: string;
  authUserId: string;
  email: string;
  displayName: string;
  status: string;
  organizationId: string | null;
  schoolId: string | null;
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async syncUser(authUser: SupabaseUser): Promise<ErpUserProfile> {
    if (!authUser.email) {
      throw new BadRequestException(
        'An email address is required to create an ERP user profile',
      );
    }

    const displayName = this.getDisplayName(authUser);
    const user = await this.database.user.upsert({
      where: { authUserId: authUser.id },
      create: {
        authUserId: authUser.id,
        email: authUser.email,
        displayName,
      },
      update: {
        email: authUser.email,
        displayName,
      },
    });

    return this.toProfile(user);
  }

  private getDisplayName(authUser: SupabaseUser): string {
    const metadataName = authUser.userMetadata.full_name;
    if (typeof metadataName === 'string' && metadataName.trim()) {
      return metadataName.trim();
    }

    const name = authUser.email?.split('@')[0];
    return name || 'ERP User';
  }

  private toProfile(user: {
    id: string;
    authUserId: string;
    email: string;
    displayName: string;
    status: string;
    organizationId: string | null;
    schoolId: string | null;
  }): ErpUserProfile {
    return {
      id: user.id,
      authUserId: user.authUserId,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      organizationId: user.organizationId,
      schoolId: user.schoolId,
    };
  }
}
