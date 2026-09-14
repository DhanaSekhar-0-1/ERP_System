import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementStatus, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly database: DatabaseService) {}

  async create(authUser: SupabaseUser, input: CreateAnnouncementDto) {
    const context = await this.getContext(authUser);
    await this.validateTargets(context.schoolId, input);
    return this.database.announcement.create({
      data: {
        schoolId: context.schoolId,
        createdById: context.id,
        title: input.title.trim(),
        content: input.content.trim(),
        targetClassId: input.targetClassId,
        targetSectionId: input.targetSectionId,
        targetRole: input.targetRole?.trim() || null,
        targetMetadata: input.targetMetadata as Prisma.InputJsonValue | undefined,
      },
      include: this.includeRelations(),
    });
  }

  async findMany(authUser: SupabaseUser, status?: string) {
    const context = await this.getContext(authUser);
    return this.database.announcement.findMany({
      where: {
        schoolId: context.schoolId,
        ...(status && Object.values(AnnouncementStatus).includes(status as AnnouncementStatus)
          ? { status: status as AnnouncementStatus }
          : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      include: this.includeRelations(),
    });
  }

  async findOne(authUser: SupabaseUser, announcementId: string) {
    const context = await this.getContext(authUser);
    const announcement = await this.database.announcement.findFirst({
      where: { id: announcementId, schoolId: context.schoolId },
      include: this.includeRelations(),
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async update(
    authUser: SupabaseUser,
    announcementId: string,
    input: UpdateAnnouncementDto,
  ) {
    const context = await this.getContext(authUser);
    const existing = await this.database.announcement.findFirst({
      where: { id: announcementId, schoolId: context.schoolId },
    });
    if (!existing) throw new NotFoundException('Announcement not found');
    const merged = {
      targetClassId: input.targetClassId ?? existing.targetClassId ?? undefined,
      targetSectionId: input.targetSectionId ?? existing.targetSectionId ?? undefined,
    };
    await this.validateTargets(context.schoolId, merged);
    return this.database.announcement.update({
      where: { id: existing.id },
      data: {
        title: input.title === undefined ? undefined : input.title.trim(),
        content: input.content === undefined ? undefined : input.content.trim(),
        targetClassId: input.targetClassId,
        targetSectionId: input.targetSectionId,
        targetRole:
          input.targetRole === undefined ? undefined : input.targetRole.trim() || null,
        targetMetadata: input.targetMetadata as Prisma.InputJsonValue | undefined,
      },
      include: this.includeRelations(),
    });
  }

  async remove(authUser: SupabaseUser, announcementId: string) {
    const existing = await this.findOne(authUser, announcementId);
    return this.database.announcement.delete({ where: { id: existing.id } });
  }

  async publish(authUser: SupabaseUser, announcementId: string) {
    const existing = await this.findOne(authUser, announcementId);
    return this.database.announcement.update({
      where: { id: existing.id },
      data: { status: AnnouncementStatus.PUBLISHED, publishedAt: new Date() },
      include: this.includeRelations(),
    });
  }

  async archive(authUser: SupabaseUser, announcementId: string) {
    const existing = await this.findOne(authUser, announcementId);
    return this.database.announcement.update({
      where: { id: existing.id },
      data: { status: AnnouncementStatus.ARCHIVED, archivedAt: new Date() },
      include: this.includeRelations(),
    });
  }

  private async validateTargets(
    schoolId: string,
    input: { targetClassId?: string; targetSectionId?: string },
  ) {
    if (input.targetClassId) {
      const schoolClass = await this.database.schoolClass.findFirst({
        where: { id: input.targetClassId, schoolId },
        select: { id: true },
      });
      if (!schoolClass) throw new NotFoundException('Announcement target class not found');
    }
    if (input.targetSectionId) {
      const section = await this.database.section.findFirst({
        where: { id: input.targetSectionId, schoolId },
        select: { id: true, classId: true },
      });
      if (!section) throw new NotFoundException('Announcement target section not found');
      if (input.targetClassId && section.classId !== input.targetClassId) {
        throw new ForbiddenException('Announcement section is outside the target class');
      }
    }
  }

  private async getContext(authUser: SupabaseUser) {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: { id: true, schoolId: true, status: true },
    });
    if (!user) throw new ForbiddenException('ERP user profile is required');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('ERP user is not active');
    if (!user.schoolId) throw new ForbiddenException('ERP user is not assigned to a school');
    return { ...user, schoolId: user.schoolId };
  }

  private includeRelations() {
    return {
      targetClass: true,
      targetSection: true,
      createdBy: { select: { id: true, displayName: true, email: true } },
    };
  }
}
