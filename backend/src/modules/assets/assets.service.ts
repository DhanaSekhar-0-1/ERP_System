import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import {
  AssetQueryDto,
  AssignAssetDto,
  CreateAssetDto,
  DisposeAssetDto,
  MaintenanceDto,
  TransferAssetDto,
  UpdateAssetDto,
} from './assets.dto';

/** Every change to an asset appends an event, giving each asset its own history. */
@Injectable()
export class AssetsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
  ) {}

  async findMany(authUser: SupabaseUser, query: AssetQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.asset.findMany({
      where: {
        schoolId: context.schoolId,
        ...(query.category ? { category: query.category } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.location ? { location: query.location } : {}),
      },
      orderBy: { assetTag: 'asc' },
      include: { assignedTo: { select: { id: true, user: { select: { displayName: true } } } } },
      take: 2000,
    });
  }

  async findOne(authUser: SupabaseUser, assetId: string) {
    const context = await this.access.schoolContext(authUser);
    return this.scoped(context, assetId);
  }

  async create(authUser: SupabaseUser, input: CreateAssetDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.asset.create({
      data: {
        schoolId: context.schoolId,
        assetTag: input.assetTag.trim().toUpperCase(),
        name: input.name.trim(),
        category: input.category.trim(),
        location: input.location?.trim() || null,
        condition: input.condition?.trim() || null,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
        purchaseCost: input.purchaseCost ?? null,
        events: { create: { type: 'CREATED', actorId: context.userId } },
      },
    });
  }

  async update(authUser: SupabaseUser, assetId: string, input: UpdateAssetDto) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.scoped(context, assetId);
    this.assertNotDisposed(asset.status);
    return this.event(context, asset.id, 'UPDATED', undefined, input, { ...input });
  }

  async assign(authUser: SupabaseUser, assetId: string, input: AssignAssetDto) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.scoped(context, assetId);
    this.assertNotDisposed(asset.status);
    const staff = await this.database.staffProfile.findFirst({
      where: { id: input.staffId, schoolId: context.schoolId },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    return this.event(context, asset.id, 'ASSIGNED', input.note, { assignedToStaffId: staff.id }, {
      from: asset.assignedToStaffId,
      to: staff.id,
    });
  }

  async transfer(authUser: SupabaseUser, assetId: string, input: TransferAssetDto) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.scoped(context, assetId);
    this.assertNotDisposed(asset.status);
    return this.event(context, asset.id, 'TRANSFERRED', input.note, { location: input.location.trim() }, {
      from: asset.location,
      to: input.location.trim(),
    });
  }

  async maintenance(authUser: SupabaseUser, assetId: string, input: MaintenanceDto) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.scoped(context, assetId);
    this.assertNotDisposed(asset.status);
    if (input.status === 'DISPOSED') {
      throw new BadRequestException('Use the dispose action to dispose of an asset');
    }
    return this.event(context, asset.id, 'MAINTENANCE', input.note, { status: input.status }, {
      status: input.status,
    });
  }

  async dispose(authUser: SupabaseUser, assetId: string, input: DisposeAssetDto) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertAdmin(context);
    const asset = await this.scoped(context, assetId);
    this.assertNotDisposed(asset.status);
    return this.event(context, asset.id, 'DISPOSED', input.reason, {
      status: 'DISPOSED',
      assignedToStaffId: null,
    });
  }

  async history(authUser: SupabaseUser, assetId: string) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.scoped(context, assetId);
    return this.database.assetEvent.findMany({
      where: { assetId: asset.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async event(
    context: SchoolContext,
    assetId: string,
    type: string,
    note: string | undefined,
    data: Prisma.AssetUncheckedUpdateInput,
    details?: Record<string, unknown>,
  ) {
    return this.database.$transaction(async (transaction) => {
      await transaction.assetEvent.create({
        data: {
          assetId,
          type,
          note: note?.trim() || null,
          data: details as Prisma.InputJsonValue | undefined,
          actorId: context.userId,
        },
      });
      return transaction.asset.update({ where: { id: assetId }, data });
    });
  }

  private assertNotDisposed(status: string) {
    if (status === 'DISPOSED') throw new ConflictException('This asset has been disposed of');
  }

  private async scoped(context: SchoolContext, assetId: string) {
    const asset = await this.database.asset.findFirst({
      where: { id: assetId, schoolId: context.schoolId },
      include: { assignedTo: { select: { id: true, user: { select: { displayName: true } } } } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }
}
