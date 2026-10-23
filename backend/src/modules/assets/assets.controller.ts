import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import {
  AssetQueryDto,
  AssignAssetDto,
  CreateAssetDto,
  DisposeAssetDto,
  MaintenanceDto,
  TransferAssetDto,
  UpdateAssetDto,
} from './assets.dto';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermissions('assets:read')
  findMany(@CurrentUser() user: SupabaseUser, @Query() query: AssetQueryDto) {
    return this.assets.findMany(user, query);
  }

  @Post()
  @RequirePermissions('assets:manage')
  create(@CurrentUser() user: SupabaseUser, @Body() input: CreateAssetDto) {
    return this.assets.create(user, input);
  }

  @Get(':assetId')
  @RequirePermissions('assets:read')
  findOne(@CurrentUser() user: SupabaseUser, @Param('assetId', ParseUUIDPipe) id: string) {
    return this.assets.findOne(user, id);
  }

  @Patch(':assetId')
  @RequirePermissions('assets:manage')
  update(
    @CurrentUser() user: SupabaseUser,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: UpdateAssetDto,
  ) {
    return this.assets.update(user, id, input);
  }

  @Post(':assetId/assign')
  @RequirePermissions('assets:manage')
  assign(
    @CurrentUser() user: SupabaseUser,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: AssignAssetDto,
  ) {
    return this.assets.assign(user, id, input);
  }

  @Post(':assetId/transfer')
  @RequirePermissions('assets:manage')
  transfer(
    @CurrentUser() user: SupabaseUser,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: TransferAssetDto,
  ) {
    return this.assets.transfer(user, id, input);
  }

  @Post(':assetId/maintenance')
  @RequirePermissions('assets:manage')
  maintenance(
    @CurrentUser() user: SupabaseUser,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: MaintenanceDto,
  ) {
    return this.assets.maintenance(user, id, input);
  }

  @Post(':assetId/dispose')
  @RequirePermissions('assets:manage')
  dispose(
    @CurrentUser() user: SupabaseUser,
    @Param('assetId', ParseUUIDPipe) id: string,
    @Body() input: DisposeAssetDto,
  ) {
    return this.assets.dispose(user, id, input);
  }

  @Get(':assetId/history')
  @RequirePermissions('assets:read')
  history(@CurrentUser() user: SupabaseUser, @Param('assetId', ParseUUIDPipe) id: string) {
    return this.assets.history(user, id);
  }
}
