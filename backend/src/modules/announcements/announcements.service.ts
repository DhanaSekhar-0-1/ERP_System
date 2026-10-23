import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementStatus, Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { NotifyService } from '../../common/notify/notify.service';
import { ROLE } from '../../common/access/roles';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
  ) {}

  async create(authUser: SupabaseUser, input: CreateAnnouncementDto) {
    const context = await this.getContext(authUser);
    await this.validateTargets(context.schoolId, input);
    return this.database.announcement.create({
      data: {
        schoolId: context.schoolId,
        createdById: context.userId,
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
        AND: [
          await this.audienceWhere(context),
          status && Object.values(AnnouncementStatus).includes(status as AnnouncementStatus)
            ? { status: status as AnnouncementStatus }
            : {},
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      include: this.includeRelations(),
      take: 200,
    });
  }

  async findOne(authUser: SupabaseUser, announcementId: string) {
    const context = await this.getContext(authUser);
    const announcement = await this.database.announcement.findFirst({
      where: { AND: [{ id: announcementId }, await this.audienceWhere(context)] },
      include: this.includeRelations(),
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  /**
   * Managers see every announcement. Everyone else sees published ones that are untargeted
   * or aimed at their role, class, or section (a parent through their children).
   */
  private async audienceWhere(context: SchoolContext): Promise<Prisma.AnnouncementWhereInput> {
    if (this.access.hasPermission(context, 'announcements:manage')) {
      return { schoolId: context.schoolId };
    }
    const classIds = new Set<string>();
    const sectionIds = new Set<string>();
    if (context.isTeacher) {
      const coverage = await this.access.teacherCoverage(context);
      coverage.classIds.forEach((id) => classIds.add(id));
      coverage.sectionIds.forEach((id) => sectionIds.add(id));
      const sections = await this.database.section.findMany({
        where: { id: { in: coverage.sectionIds } },
        select: { classId: true },
      });
      sections.forEach((section) => classIds.add(section.classId));
    }
    const scope = await this.access.studentScope(context);
    if (!scope.all && (context.isStudent || context.isParent)) {
      const enrollments = await this.database.enrollment.findMany({
        where: { studentId: { in: scope.ids }, status: 'ACTIVE' },
        select: { classId: true, sectionId: true },
      });
      enrollments.forEach((enrollment) => {
        classIds.add(enrollment.classId);
        sectionIds.add(enrollment.sectionId);
      });
    }
    return {
      schoolId: context.schoolId,
      status: AnnouncementStatus.PUBLISHED,
      AND: [
        { OR: [{ targetRole: null }, { targetRole: { in: context.roles } }] },
        { OR: [{ targetClassId: null }, { targetClassId: { in: [...classIds] } }] },
        { OR: [{ targetSectionId: null }, { targetSectionId: { in: [...sectionIds] } }] },
      ],
    };
  }

  private async notifyAudience(announcement: {
    id: string;
    schoolId: string;
    title: string;
    targetRole: string | null;
    targetClassId: string | null;
    targetSectionId: string | null;
  }) {
    const input = {
      type: 'announcement.published',
      title: announcement.title,
      body: 'A new announcement was published.',
      schoolId: announcement.schoolId,
      data: { announcementId: announcement.id },
    };
    if (announcement.targetClassId || announcement.targetSectionId) {
      const enrollments = await this.database.enrollment.findMany({
        where: {
          schoolId: announcement.schoolId,
          status: 'ACTIVE',
          ...(announcement.targetClassId ? { classId: announcement.targetClassId } : {}),
          ...(announcement.targetSectionId ? { sectionId: announcement.targetSectionId } : {}),
        },
        select: { studentId: true },
      });
      for (const { studentId } of enrollments) {
        await this.notify.toStudentFamily(studentId, input);
      }
      return;
    }
    const roles = announcement.targetRole
      ? [announcement.targetRole]
      : [ROLE.TEACHER, ROLE.STUDENT, ROLE.PARENT, ROLE.PRINCIPAL, ROLE.ACCOUNTANT];
    await this.notify.toRoles(announcement.schoolId, roles, input);
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
    if (existing.status === AnnouncementStatus.PUBLISHED) {
      throw new ConflictException('Announcement is already published');
    }
    const published = await this.database.announcement.update({
      where: { id: existing.id },
      data: { status: AnnouncementStatus.PUBLISHED, publishedAt: new Date(), archivedAt: null },
      include: this.includeRelations(),
    });
    await this.notifyAudience(published);
    return published;
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

  private getContext(authUser: SupabaseUser): Promise<SchoolContext> {
    return this.access.schoolContext(authUser);
  }

  private includeRelations() {
    return {
      targetClass: true,
      targetSection: true,
      createdBy: { select: { id: true, displayName: true, email: true } },
    };
  }
}
