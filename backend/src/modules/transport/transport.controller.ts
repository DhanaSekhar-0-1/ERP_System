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
  BoardingEventDto,
  BoardingQueryDto,
  CreateAllocationDto,
  CreateBusDto,
  CreateDriverDto,
  CreateRouteDto,
  CreateStopDto,
  UpdateAllocationDto,
  UpdateBusDto,
  UpdateDriverDto,
  UpdateRouteDto,
  UpdateStopDto,
} from './dto/transport.dto';
import { TransportService } from './transport.service';

@Controller('transport')
export class TransportController {
  constructor(private readonly transport: TransportService) {}

  @Get('routes')
  @RequirePermissions('transport:read')
  routes(@CurrentUser() user: SupabaseUser) {
    return this.transport.routes(user);
  }

  @Post('routes')
  @RequirePermissions('transport:manage')
  createRoute(@CurrentUser() user: SupabaseUser, @Body() input: CreateRouteDto) {
    return this.transport.createRoute(user, input);
  }

  @Get('routes/:routeId')
  @RequirePermissions('transport:read')
  route(@CurrentUser() user: SupabaseUser, @Param('routeId', ParseUUIDPipe) id: string) {
    return this.transport.route(user, id);
  }

  @Patch('routes/:routeId')
  @RequirePermissions('transport:manage')
  updateRoute(
    @CurrentUser() user: SupabaseUser,
    @Param('routeId', ParseUUIDPipe) id: string,
    @Body() input: UpdateRouteDto,
  ) {
    return this.transport.updateRoute(user, id, input);
  }

  @Get('stops')
  @RequirePermissions('transport:read')
  stops(
    @CurrentUser() user: SupabaseUser,
    @Query('routeId', new ParseUUIDPipe({ optional: true })) routeId?: string,
  ) {
    return this.transport.stops(user, routeId);
  }

  @Post('stops')
  @RequirePermissions('transport:manage')
  createStop(@CurrentUser() user: SupabaseUser, @Body() input: CreateStopDto) {
    return this.transport.createStop(user, input);
  }

  @Patch('stops/:stopId')
  @RequirePermissions('transport:manage')
  updateStop(
    @CurrentUser() user: SupabaseUser,
    @Param('stopId', ParseUUIDPipe) id: string,
    @Body() input: UpdateStopDto,
  ) {
    return this.transport.updateStop(user, id, input);
  }

  @Get('buses')
  @RequirePermissions('transport:read')
  buses(@CurrentUser() user: SupabaseUser) {
    return this.transport.buses(user);
  }

  @Post('buses')
  @RequirePermissions('transport:manage')
  createBus(@CurrentUser() user: SupabaseUser, @Body() input: CreateBusDto) {
    return this.transport.createBus(user, input);
  }

  @Patch('buses/:busId')
  @RequirePermissions('transport:manage')
  updateBus(
    @CurrentUser() user: SupabaseUser,
    @Param('busId', ParseUUIDPipe) id: string,
    @Body() input: UpdateBusDto,
  ) {
    return this.transport.updateBus(user, id, input);
  }

  @Get('drivers')
  @RequirePermissions('transport:manage')
  drivers(@CurrentUser() user: SupabaseUser) {
    return this.transport.drivers(user);
  }

  @Post('drivers')
  @RequirePermissions('transport:manage')
  createDriver(@CurrentUser() user: SupabaseUser, @Body() input: CreateDriverDto) {
    return this.transport.createDriver(user, input);
  }

  @Patch('drivers/:driverId')
  @RequirePermissions('transport:manage')
  updateDriver(
    @CurrentUser() user: SupabaseUser,
    @Param('driverId', ParseUUIDPipe) id: string,
    @Body() input: UpdateDriverDto,
  ) {
    return this.transport.updateDriver(user, id, input);
  }

  @Post('allocations')
  @RequirePermissions('transport:manage')
  allocate(@CurrentUser() user: SupabaseUser, @Body() input: CreateAllocationDto) {
    return this.transport.allocate(user, input);
  }

  @Patch('allocations/:allocationId')
  @RequirePermissions('transport:manage')
  updateAllocation(
    @CurrentUser() user: SupabaseUser,
    @Param('allocationId', ParseUUIDPipe) id: string,
    @Body() input: UpdateAllocationDto,
  ) {
    return this.transport.updateAllocation(user, id, input);
  }

  @Post('boarding-events')
  @RequirePermissions('transport:manage')
  board(@CurrentUser() user: SupabaseUser, @Body() input: BoardingEventDto) {
    return this.transport.recordBoarding(user, input);
  }

  @Get('boarding-events')
  @RequirePermissions('transport:manage')
  boardingEvents(@CurrentUser() user: SupabaseUser, @Query() query: BoardingQueryDto) {
    return this.transport.boardingEvents(user, query);
  }
}

@Controller('students/:studentId/transport')
export class StudentTransportController {
  constructor(private readonly transport: TransportService) {}

  @Get()
  @RequirePermissions('transport:read')
  studentTransport(
    @CurrentUser() user: SupabaseUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.transport.studentTransport(user, studentId);
  }
}
