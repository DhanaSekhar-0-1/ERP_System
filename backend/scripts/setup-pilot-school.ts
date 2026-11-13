/**
 * Sets up a brand-new database for a school's pilot (docs/hosting-guide.md, step 4):
 * the organisation, the school, its settings with the MVP1 module set and the NFC card optional,
 * the active academic year, and the first logins (Super Admin, Principal, School Admin).
 *
 * Each login gets a random first password, printed once, which must be changed at first sign-in.
 * Run it again safely: anything that already exists is left alone and existing passwords are
 * never changed.
 *
 *   npm run pilot:setup -- --env-file=.env.pilot \
 *     --school-name="Sri Vidya High School" --school-code=SVHS \
 *     --super-admin-email=you@example.com --super-admin-name="Your Name" \
 *     --principal-email=principal@example.com --principal-name="Principal Name" \
 *     --admin-email=office@example.com --admin-name="Office Admin"
 */
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { mvp1States } from '../src/common/school-modules/school-modules';

function option(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length).trim() || fallback;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

// Load the pilot's settings, never the development .env by accident.
const envFile = option('env-file');
if (!envFile) throw new Error('Pass --env-file=.env.pilot (the new Supabase project settings)');
const loaded = config({ path: envFile, override: true });
if (loaded.error) throw new Error(`Cannot read ${envFile}: ${loaded.error.message}`);

const prisma = new PrismaClient();

/** Upper, lower, digit and symbol, so it passes the password rules. */
function firstPassword(): string {
  const body = randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
  return `Pilot@${body}7a`;
}

async function findAuthUser(client: SupabaseClient, email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Cannot list Supabase Auth users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) return null;
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error(`${envFile} must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
  const auth = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const schoolName = required('school-name');
  const schoolCode = required('school-code').toUpperCase();
  const organizationName = option('organization-name', schoolName)!;
  const organizationSlug = option('organization-slug', schoolCode.toLowerCase())!;
  const yearName = option('year-name', '2026-2027')!;
  const yearStart = option('year-start', '2026-06-01')!;
  const yearEnd = option('year-end', '2027-04-30')!;
  const people = [
    { role: 'Super Admin', email: required('super-admin-email'), name: required('super-admin-name') },
    { role: 'Principal', email: required('principal-email'), name: required('principal-name') },
    { role: 'School Admin', email: required('admin-email'), name: required('admin-name') },
  ];

  const roles = await prisma.role.findMany({ where: { name: { in: people.map((p) => p.role) } } });
  if (roles.length !== people.length) {
    throw new Error('Roles are missing: the database has not been migrated and seeded yet (see the guide, step 3)');
  }

  console.log(`Supabase project: ${url}`);
  const organization = await prisma.organization.upsert({
    where: { slug: organizationSlug },
    create: { name: organizationName, slug: organizationSlug },
    update: {},
  });
  const school = await prisma.school.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: schoolCode } },
    create: { organizationId: organization.id, name: schoolName, code: schoolCode },
    update: {},
  });

  const settings = await prisma.schoolSettings.findUnique({ where: { schoolId: school.id } });
  const metadata = (settings?.metadata as Record<string, unknown> | null) ?? {};
  const next = {
    ...metadata,
    modules: (metadata.modules as object | undefined) ?? mvp1States(),
    registration: (metadata.registration as object | undefined) ?? { requireAadhaar: true, requireNfcCard: false },
  } as Prisma.InputJsonValue;
  await prisma.schoolSettings.upsert({
    where: { schoolId: school.id },
    create: { schoolId: school.id, timezone: 'Asia/Kolkata', metadata: next },
    update: { metadata: next },
  });

  const year = await prisma.academicYear.upsert({
    where: { schoolId_name: { schoolId: school.id, name: yearName } },
    create: { schoolId: school.id, name: yearName, startsOn: new Date(yearStart), endsOn: new Date(yearEnd), isActive: true },
    update: {},
  });
  if (!(await prisma.academicYear.findFirst({ where: { schoolId: school.id, isActive: true } }))) {
    await prisma.academicYear.update({ where: { id: year.id }, data: { isActive: true } });
  }

  const logins: { role: string; email: string; firstPassword: string }[] = [];
  for (const person of people) {
    let authUser = await findAuthUser(auth, person.email);
    let password = '(already existed, unchanged)';
    if (!authUser) {
      password = firstPassword();
      const { data, error } = await auth.auth.admin.createUser({
        email: person.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: person.name },
      });
      if (error || !data.user) throw new Error(`Cannot create ${person.email}: ${error?.message}`);
      authUser = data.user;
    }
    const user = await prisma.user.upsert({
      where: { authUserId: authUser.id },
      create: {
        authUserId: authUser.id,
        email: person.email.toLowerCase(),
        displayName: person.name,
        status: 'ACTIVE',
        organizationId: organization.id,
        schoolId: school.id,
        mustChangePassword: true,
      },
      update: {},
    });
    const role = roles.find((item) => item.name === person.role)!;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    if (person.role === 'Principal') {
      await prisma.staffProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, schoolId: school.id, employeeNo: 'PRINCIPAL' },
        update: {},
      });
    }
    logins.push({ role: person.role, email: person.email, firstPassword: password });
  }

  console.log(`\nSchool "${school.name}" (${school.code}) is ready; active year ${year.name}.`);
  console.log('Modules: MVP1 set (exams, fees, notices, parent login and the rest are off). NFC card optional.');
  console.log('\nFirst logins (shown only now; each person must choose a new password at first sign-in):');
  for (const login of logins) console.log(`  ${login.role.padEnd(12)} ${login.email}  ${login.firstPassword}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
