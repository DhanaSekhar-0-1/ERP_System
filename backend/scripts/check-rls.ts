import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config({ quiet: true });

const prisma = new PrismaClient();
const DATA_API_ROLES = ['anon', 'authenticated'];

interface TableState {
  table: string;
  rls: boolean;
  grants: string[];
}

/**
 * Fails when any table in the public schema has RLS disabled or grants a privilege to the
 * Supabase Data API roles. Run after migrations: npm run db:check-rls
 */
async function main(): Promise<void> {
  const tables = await prisma.$queryRaw<TableState[]>`
    SELECT c.relname AS table,
      c.relrowsecurity AS rls,
      COALESCE(
        (SELECT array_agg(DISTINCT g.grantee || ':' || g.privilege_type ORDER BY g.grantee || ':' || g.privilege_type)
         FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = c.relname
           AND g.grantee = ANY(${DATA_API_ROLES})),
        ARRAY[]::text[]
      ) AS grants
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`;
  const problems = tables.filter((table) => !table.rls || table.grants.length);
  for (const table of problems) {
    const issues = [
      table.rls ? null : 'RLS disabled',
      table.grants.length ? `grants ${table.grants.join(', ')}` : null,
    ].filter(Boolean);
    console.error(`  ${table.table}: ${issues.join('; ')}`);
  }
  if (problems.length) {
    console.error(`${problems.length}/${tables.length} public tables are exposed to the Data API`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${tables.length} public tables have RLS enabled and no anon/authenticated grants`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
