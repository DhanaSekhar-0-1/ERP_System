import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotifyService } from '../../common/notify/notify.service';
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

@Injectable()
export class TransportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  // ---------- Routes, stops, buses, drivers ----------

  async routes(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.transportRoute.findMany({
      where: { schoolId: context.schoolId },
      orderBy: { code: 'asc' },
      include: { stops: { orderBy: { sequence: 'asc' } }, _count: { select: { allocations: { where: { isActive: true } } } } },
    });
  }

  async route(authUser: SupabaseUser, routeId: string) {
    const context = await this.access.schoolContext(authUser);
    const route = await this.database.transportRoute.findFirst({
      where: { id: routeId, schoolId: context.schoolId },
      include: { stops: { orderBy: { sequence: 'asc' } }, buses: true },
    });
    if (!route) throw new NotFoundException('Route not found');
    return route;
  }

  async createRoute(authUser: SupabaseUser, input: CreateRouteDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.transportRoute.create({
      data: {
        schoolId: context.schoolId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
      },
    });
  }

  async updateRoute(authUser: SupabaseUser, routeId: string, input: UpdateRouteDto) {
    await this.route(authUser, routeId);
    return this.database.transportRoute.update({ where: { id: routeId }, data: input });
  }

  async stops(authUser: SupabaseUser, routeId?: string) {
    const context = await this.access.schoolContext(authUser);
    return this.database.transportStop.findMany({
      where: { schoolId: context.schoolId, ...(routeId ? { routeId } : {}) },
      orderBy: [{ routeId: 'asc' }, { sequence: 'asc' }],
    });
  }

  async createStop(authUser: SupabaseUser, input: CreateStopDto) {
    const context = await this.access.schoolContext(authUser);
    await this.route(authUser, input.routeId);
    return this.database.transportStop.create({
      data: { schoolId: context.schoolId, ...input, name: input.name.trim() },
    });
  }

  async updateStop(authUser: SupabaseUser, stopId: string, input: UpdateStopDto) {
    const context = await this.access.schoolContext(authUser);
    const stop = await this.database.transportStop.findFirst({ where: { id: stopId, schoolId: context.schoolId } });
    if (!stop) throw new NotFoundException('Stop not found');
    return this.database.transportStop.update({ where: { id: stopId }, data: input });
  }

  async buses(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.bus.findMany({
      where: { schoolId: context.schoolId },
      include: { route: { select: { id: true, code: true, name: true } }, drivers: true },
      orderBy: { registrationNo: 'asc' },
    });
  }

  async createBus(authUser: SupabaseUser, input: CreateBusDto) {
    const context = await this.access.schoolContext(authUser);
    if (input.routeId) await this.route(authUser, input.routeId);
    return this.database.bus.create({
      data: {
        schoolId: context.schoolId,
        registrationNo: input.registrationNo.trim().toUpperCase(),
        capacity: input.capacity,
        routeId: input.routeId ?? null,
      },
    });
  }

  async updateBus(authUser: SupabaseUser, busId: string, input: UpdateBusDto) {
    const context = await this.access.schoolContext(authUser);
    const bus = await this.database.bus.findFirst({ where: { id: busId, schoolId: context.schoolId } });
    if (!bus) throw new NotFoundException('Bus not found');
    if (input.routeId) await this.route(authUser, input.routeId);
    return this.database.bus.update({ where: { id: busId }, data: input });
  }

  async drivers(authUser: SupabaseUser) {
    const context = await this.access.schoolContext(authUser);
    return this.database.driver.findMany({
      where: { schoolId: context.schoolId },
      include: { bus: { select: { id: true, registrationNo: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createDriver(authUser: SupabaseUser, input: CreateDriverDto) {
    const context = await this.access.schoolContext(authUser);
    if (input.busId) await this.assertBus(context, input.busId);
    return this.database.driver.create({
      data: {
        schoolId: context.schoolId,
        name: input.name.trim(),
        phone: input.phone.trim(),
        licenseNo: input.licenseNo.trim().toUpperCase(),
        role: input.role?.trim().toUpperCase() || 'DRIVER',
        busId: input.busId ?? null,
      },
    });
  }

  async updateDriver(authUser: SupabaseUser, driverId: string, input: UpdateDriverDto) {
    const context = await this.access.schoolContext(authUser);
    const driver = await this.database.driver.findFirst({ where: { id: driverId, schoolId: context.schoolId } });
    if (!driver) throw new NotFoundException('Driver not found');
    if (input.busId) await this.assertBus(context, input.busId);
    return this.database.driver.update({ where: { id: driverId }, data: input });
  }

  // ---------- Allocations ----------

  /** A student has one active allocation; a new one replaces the previous. */
  async allocate(authUser: SupabaseUser, input: CreateAllocationDto) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, input.studentId);
    const stop = await this.database.transportStop.findFirst({
      where: { id: input.stopId, routeId: input.routeId, schoolId: context.schoolId },
    });
    if (!stop) throw new NotFoundException('Stop not found on this route');
    await this.assertCapacity(context, input.routeId);
    const allocation = await this.database.$transaction(async (transaction) => {
      await transaction.transportAllocation.updateMany({
        where: { studentId: input.studentId, isActive: true },
        data: { isActive: false },
      });
      return transaction.transportAllocation.create({
        data: { schoolId: context.schoolId, ...input },
        include: { route: true, stop: true },
      });
    });
    await this.audit.record(context, {
      action: 'transport.allocated',
      entityType: 'student',
      entityId: input.studentId,
      newValue: input,
    });
    return allocation;
  }

  async updateAllocation(authUser: SupabaseUser, allocationId: string, input: UpdateAllocationDto) {
    const context = await this.access.schoolContext(authUser);
    const allocation = await this.database.transportAllocation.findFirst({
      where: { id: allocationId, schoolId: context.schoolId },
    });
    if (!allocation) throw new NotFoundException('Allocation not found');
    if (input.stopId) {
      const stop = await this.database.transportStop.findFirst({
        where: { id: input.stopId, routeId: allocation.routeId },
      });
      if (!stop) throw new BadRequestException('Stop is not on the allocated route');
    }
    return this.database.transportAllocation.update({
      where: { id: allocationId },
      data: input,
      include: { route: true, stop: true },
    });
  }

  async studentTransport(authUser: SupabaseUser, studentId: string) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, studentId);
    const allocation = await this.database.transportAllocation.findFirst({
      where: { studentId, isActive: true },
      include: {
        route: { include: { buses: { include: { drivers: { select: { name: true, phone: true, role: true } } } } } },
        stop: true,
      },
    });
    const recentEvents = await this.database.boardingEvent.findMany({
      where: { studentId },
      orderBy: { occurredAt: 'desc' },
      take: 10,
    });
    return { allocation, recentEvents };
  }

  // ---------- Boarding ----------

  async recordBoarding(authUser: SupabaseUser, input: BoardingEventDto) {
    const context = await this.access.schoolContext(authUser);
    if (!input.studentId && !input.nfcId) {
      throw new BadRequestException('Provide studentId or nfcId');
    }
    const student = await this.database.student.findFirst({
      where: {
        schoolId: context.schoolId,
        isArchived: false,
        ...(input.studentId ? { id: input.studentId } : { nfcId: input.nfcId?.trim() }),
      },
    });
    if (!student) throw new NotFoundException('Student not found for this card');
    if (input.busId) await this.assertBus(context, input.busId);
    const event = await this.database.boardingEvent.create({
      data: {
        schoolId: context.schoolId,
        studentId: student.id,
        busId: input.busId ?? null,
        type: input.type,
        nfcId: input.nfcId ?? null,
        recordedById: context.userId,
      },
    });
    await this.notify.toStudentFamily(student.id, {
      type: `transport.${input.type.toLowerCase()}`,
      title: input.type === 'BOARDED' ? 'Boarded the bus' : 'Dropped off',
      body: `${student.firstName} ${input.type === 'BOARDED' ? 'boarded the bus' : 'was dropped off'} at ${event.occurredAt.toISOString().slice(11, 16)} UTC.`,
      data: { boardingEventId: event.id },
    });
    return event;
  }

  async boardingEvents(authUser: SupabaseUser, query: BoardingQueryDto) {
    const context = await this.access.schoolContext(authUser);
    const day = query.date ? new Date(query.date.slice(0, 10)) : null;
    return this.database.boardingEvent.findMany({
      where: {
        schoolId: context.schoolId,
        ...(query.busId ? { busId: query.busId } : {}),
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(day ? { occurredAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      take: 1000,
    });
  }

  private async assertCapacity(context: SchoolContext, routeId: string) {
    const [buses, allocated] = await Promise.all([
      this.database.bus.aggregate({ where: { routeId, isActive: true }, _sum: { capacity: true } }),
      this.database.transportAllocation.count({ where: { routeId, isActive: true } }),
    ]);
    const capacity = buses._sum.capacity ?? 0;
    if (capacity > 0 && allocated >= capacity) {
      throw new ConflictException(`Route is full (${allocated}/${capacity} seats)`);
    }
  }

  private async assertBus(context: SchoolContext, busId: string) {
    const bus = await this.database.bus.findFirst({ where: { id: busId, schoolId: context.schoolId } });
    if (!bus) throw new NotFoundException('Bus not found');
    return bus;
  }

}
