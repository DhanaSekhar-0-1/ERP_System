import { PrismaClient } from '@prisma/client';

interface BootstrapOptions {
  authUserId: string;
  email: string;
  organizationName: string;
  organizationSlug: string;
  schoolName: string;
  schoolCode: string;
}

const prisma = new PrismaClient();

function getOption(name: string): string {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const value = argument?.slice(prefix.length).trim();

  if (!value) {
    throw new Error(`Missing required option --${name}=...`);
  }

  return value;
}

function getOptions(): BootstrapOptions {
  return {
    authUserId: getOption('auth-user-id'),
    email: getOption('email'),
    organizationName: getOption('organization-name'),
    organizationSlug: getOption('organization-slug'),
    schoolName: getOption('school-name'),
    schoolCode: getOption('school-code'),
  };
}

async function main(): Promise<void> {
  const options = getOptions();
  const role = await prisma.role.findUnique({
    where: { name: 'Super Admin' },
  });

  if (!role) {
    throw new Error('Super Admin role is missing; run npm run prisma:seed first');
  }

  const result = await prisma.$transaction(async (transaction) => {
    const organization = await transaction.organization.upsert({
      where: { slug: options.organizationSlug },
      create: {
        name: options.organizationName,
        slug: options.organizationSlug,
      },
      update: {
        name: options.organizationName,
      },
    });

    const school = await transaction.school.upsert({
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
      update: {
        name: options.schoolName,
      },
    });

    const user = await transaction.user.upsert({
      where: { authUserId: options.authUserId },
      create: {
        authUserId: options.authUserId,
        email: options.email,
        displayName: options.email.split('@')[0],
        status: 'ACTIVE',
        organizationId: organization.id,
        schoolId: school.id,
      },
      update: {
        email: options.email,
        status: 'ACTIVE',
        organizationId: organization.id,
        schoolId: school.id,
      },
    });

    await transaction.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: role.id,
        },
      },
      create: {
        userId: user.id,
        roleId: role.id,
      },
      update: {},
    });

    return { organizationId: organization.id, schoolId: school.id, userId: user.id };
  });

  console.log(JSON.stringify(result));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
