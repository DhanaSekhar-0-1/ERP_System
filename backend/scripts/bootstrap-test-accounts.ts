import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

config();

interface AccountOptions {
  organizationSlug: string;
  schoolCode: string;
  schoolName: string;
  adminEmail: string;
  teacherEmail: string;
  studentEmail: string;
  adminPassword?: string;
  teacherPassword?: string;
  studentPassword?: string;
}

const prisma = new PrismaClient();

function option(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length).trim() || fallback;
}

function requiredOption(name: string, fallback?: string): string {
  const value = option(name, fallback);
  if (!value) throw new Error(`Missing required option --${name}=...`);
  return value;
}

function getOptions(): AccountOptions {
  return {
    organizationSlug: requiredOption('organization-slug', 'erp-test-organization'),
    schoolCode: requiredOption('school-code', 'ERP-TEST-001'),
    schoolName: requiredOption('school-name', 'ERP Test School'),
    adminEmail: requiredOption('admin-email', 'test.admin@erp.local'),
    teacherEmail: requiredOption('teacher-email', 'test.teacher@erp.local'),
    studentEmail: requiredOption('student-email', 'test.student@erp.local'),
    adminPassword: option('admin-password'),
    teacherPassword: option('teacher-password'),
    studentPassword: option('student-password'),
  };
}

function password(provided: string | undefined): string {
  return provided ?? `Test@${randomBytes(9).toString('base64url')}1`;
}

async function findAuthUser(
  adminClient: SupabaseClient,
  email: string,
): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw new Error(`Unable to list Supabase Auth users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) return null;
  }
}

async function ensureAuthUser(
  adminClient: SupabaseClient,
  email: string,
  displayName: string,
  accountPassword: string,
): Promise<User> {
  const existing = await findAuthUser(adminClient, email);
  if (existing) {
    const { data, error } = await adminClient.auth.admin.updateUserById(existing.id, {
      email,
      password: accountPassword,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (error || !data.user) throw new Error(error?.message ?? `Unable to update ${email}`);
    return data.user;
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: accountPassword,
    email_confirm: true,
    user_metadata: { full_name: displayName },
  });
  if (error || !data.user) throw new Error(error?.message ?? `Unable to create ${email}`);
  return data.user;
}

async function assignRole(userId: string, roleName: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new Error(`Role "${roleName}" is missing; run npm run prisma:seed first`);
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
}

async function main(): Promise<void> {
  const options = getOptions();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const organization = await prisma.organization.upsert({
    where: { slug: options.organizationSlug },
    create: { name: 'ERP Test Organization', slug: options.organizationSlug },
    update: {},
  });
  const school = await prisma.school.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: options.schoolCode,
      },
    },
    create: {
      organizationId: organization.id,
      name: options.schoolName,
      code: options.schoolCode,
    },
    update: { name: options.schoolName },
  });

  const accounts = [
    {
      email: options.adminEmail,
      displayName: 'Test School Admin',
      role: 'School Admin',
      accountPassword: password(options.adminPassword),
    },
    {
      email: options.teacherEmail,
      displayName: 'Test Teacher',
      role: 'Teacher',
      accountPassword: password(options.teacherPassword),
    },
    {
      email: options.studentEmail,
      displayName: 'Test Student',
      role: 'Student',
      accountPassword: password(options.studentPassword),
    },
  ];

  const created = [];
  for (const account of accounts) {
    const authUser = await ensureAuthUser(
      adminClient,
      account.email,
      account.displayName,
      account.accountPassword,
    );
    const user = await prisma.user.upsert({
      where: { authUserId: authUser.id },
      create: {
        authUserId: authUser.id,
        email: account.email,
        displayName: account.displayName,
        status: 'ACTIVE',
        organizationId: organization.id,
        schoolId: school.id,
      },
      update: {
        email: account.email,
        displayName: account.displayName,
        status: 'ACTIVE',
        organizationId: organization.id,
        schoolId: school.id,
      },
    });
    await assignRole(user.id, account.role);

    let studentId: string | undefined;
    if (account.role === 'Teacher') {
      await prisma.staffProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          schoolId: school.id,
          employeeNo: 'TEST-TEACHER-001',
          nfcId: 'TEST-NFC-TEACHER-001',
        },
        update: { schoolId: school.id, employeeNo: 'TEST-TEACHER-001', nfcId: 'TEST-NFC-TEACHER-001' },
      });
    }
    if (account.role === 'Student') {
      const student = await prisma.student.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          schoolId: school.id,
          admissionNo: 'TEST-STUDENT-001',
          nfcId: 'TEST-NFC-STUDENT-001',
          firstName: 'Test',
          lastName: 'Student',
        },
        update: {
          schoolId: school.id,
          admissionNo: 'TEST-STUDENT-001',
          nfcId: 'TEST-NFC-STUDENT-001',
          firstName: 'Test',
          lastName: 'Student',
        },
      });
      studentId = student.id;
    }
    created.push({
      role: account.role,
      email: account.email,
      password: account.accountPassword,
      authUserId: authUser.id,
      erpUserId: user.id,
      studentId,
    });
  }

  console.log(JSON.stringify({ organizationId: organization.id, schoolId: school.id, accounts: created }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
