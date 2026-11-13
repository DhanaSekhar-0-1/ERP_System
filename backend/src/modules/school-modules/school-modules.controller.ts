import { Body, Controller, Get, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { DatabaseService } from '../../common/database/database.service';
import { moduleStates, SCHOOL_MODULES, SchoolModuleKey } from '../../common/school-modules/school-modules';

class RegistrationSwitchesDto {
  @IsOptional()
  @IsBoolean()
  requireAadhaar?: boolean;

  @IsOptional()
  @IsBoolean()
  requireNfcCard?: boolean;
}

class UpdateSchoolModulesDto {
  /** { exams: false, fees: false, ... }; unknown keys are ignored. */
  @IsOptional()
  @IsObject()
  modules?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  registration?: RegistrationSwitchesDto;
}

/** The school's module switches and registration switches (docs/mvp-plan.md, "Pilot setup"). */
@Controller('school-modules')
export class SchoolModulesController {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('schools:read')
  async get(@CurrentUser() user: SupabaseUser) {
    const context = await this.access.schoolContext(user);
    return this.view(await this.metadata(context.schoolId));
  }

  @Put()
  @RequirePermissions('schools:manage')
  async update(@CurrentUser() user: SupabaseUser, @Body() input: UpdateSchoolModulesDto) {
    const context = await this.access.schoolContext(user);
    this.access.assertAdmin(context, 'Only the School Admin or Super Admin can switch modules');
    const metadata = await this.metadata(context.schoolId);
    const before = this.view(metadata);
    const known = new Set<string>(SCHOOL_MODULES.map((item) => item.key));
    const modules = { ...((metadata.modules as Record<string, boolean>) ?? {}) };
    for (const [key, value] of Object.entries(input.modules ?? {})) {
      if (known.has(key) && typeof value === 'boolean') modules[key] = value;
    }
    const registration = { ...((metadata.registration as Record<string, unknown>) ?? {}) };
    if (input.registration?.requireAadhaar !== undefined) registration.requireAadhaar = input.registration.requireAadhaar;
    if (input.registration?.requireNfcCard !== undefined) registration.requireNfcCard = input.registration.requireNfcCard;
    const next = { ...metadata, modules, registration } as Prisma.InputJsonValue;
    await this.database.schoolSettings.upsert({
      where: { schoolId: context.schoolId },
      create: { schoolId: context.schoolId, timezone: 'Asia/Kolkata', metadata: next },
      update: { metadata: next },
    });
    // Everyone's cached context carries the switches; read them again on the next request.
    this.access.invalidate();
    const after = this.view(next as Record<string, unknown>);
    await this.audit.record(context, {
      action: 'school-modules.updated',
      entityType: 'school',
      entityId: context.schoolId,
      oldValue: { modules: before.states, registration: before.registration },
      newValue: { modules: after.states, registration: after.registration },
    });
    return after;
  }

  private async metadata(schoolId: string): Promise<Record<string, unknown>> {
    const settings = await this.database.schoolSettings.findUnique({ where: { schoolId }, select: { metadata: true } });
    return (settings?.metadata as Record<string, unknown> | null) ?? {};
  }

  private view(metadata: Record<string, unknown>) {
    const states = moduleStates(metadata);
    const registration = (metadata.registration as { requireAadhaar?: boolean; requireNfcCard?: boolean } | undefined) ?? {};
    return {
      states,
      modules: SCHOOL_MODULES.map((item) => ({
        key: item.key as SchoolModuleKey,
        label: item.label,
        description: item.description,
        enabled: states[item.key],
        inMvp1: item.mvp1,
      })),
      registration: {
        requireAadhaar: registration.requireAadhaar ?? true,
        requireNfcCard: registration.requireNfcCard ?? true,
      },
    };
  }
}
