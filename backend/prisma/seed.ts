import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const roleDefinitions = [
  {
    name: 'Super Admin',
    description: 'Organization-wide platform administrator',
    permissions: [
      'organizations:read',
      'organizations:manage',
      'schools:read',
      'schools:manage',
      'users:read',
      'users:manage',
      'roles:read',
      'roles:manage',
      'permissions:read',
      'audit:read',
    ],
  },
  {
    name: 'School Admin',
    description: 'Full operational administrator for an assigned school',
    permissions: [
      'schools:read',
      'users:read',
      'users:manage',
      'roles:read',
      'students:read',
      'students:manage',
      'guardians:read',
      'guardians:manage',
      'academic-years:read',
      'academic-years:manage',
      'classes:read',
      'classes:manage',
      'sections:read',
      'sections:manage',
      'attendance:read',
      'attendance:manage',
      'audit:read',
      'approvals:read',
      'approvals:manage',
    ],
  },
  {
    name: 'Principal',
    description: 'Academic and administrative oversight',
    permissions: [
      'schools:read',
      'users:read',
      'students:read',
      'guardians:read',
      'academic-years:read',
      'classes:read',
      'sections:read',
      'attendance:read',
      'approvals:read',
      'approvals:manage',
      'audit:read',
    ],
  },
  {
    name: 'Teacher',
    description: 'Teacher access is restricted to assigned records',
    permissions: [
      'students:read',
      'students:manage',
      'guardians:read',
      'classes:read',
      'sections:read',
      'attendance:read',
      'attendance:manage',
    ],
  },
  {
    name: 'Accountant',
    description: 'Fee and finance access',
    permissions: ['students:read', 'guardians:read', 'fees:read', 'fees:manage'],
  },
  {
    name: 'Parent',
    description: 'Access to linked child records only',
    permissions: ['students:read', 'guardians:read', 'attendance:read'],
  },
  {
    name: 'Student',
    description: 'Read-only access to the student record',
    permissions: ['students:read', 'guardians:read', 'attendance:read'],
  },
];

async function main(): Promise<void> {
  for (const definition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { name: definition.name },
      create: {
        name: definition.name,
        description: definition.description,
      },
      update: {
        description: definition.description,
      },
    });

    for (const code of definition.permissions) {
      const permission = await prisma.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
        update: {},
      });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
