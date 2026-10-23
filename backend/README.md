# School ERP backend

NestJS 11 + Prisma 6 + Supabase (PostgreSQL, Auth, Storage). All routes are under
`/api/v1`. Project status and known gaps are in [../STATUS.md](../STATUS.md); the
full route catalog is in [../API's_modules.md](../API's_modules.md).

## Setup

1. Create a Supabase project and open **Project Settings > Database**.
2. Copy the **Session pooler** connection string into `DATABASE_URL`.
3. Copy the **Direct connection** string into `DIRECT_URL`. The direct host is
   IPv6-only; on an IPv4-only network use the session pooler URL (port 5432,
   without `?pgbouncer=true`) for `DIRECT_URL` instead.
4. URL-encode special characters in the password (`#` becomes `%23`).
5. Copy the project URL and keys into the remaining Supabase variables in `.env`.
6. Install, migrate, seed, and start:

   ```powershell
   npm install
   npm run prisma:generate
   npm run prisma:migrate:deploy
   npm run prisma:seed
   npm run start:dev
   ```

7. Check `GET /api/v1/health`:

   ```json
   { "data": { "status": "ok", "database": "ok" }, "meta": {}, "error": null }
   ```

Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` to a web or mobile client.

### Optional environment variables

| Variable | Used for |
|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins (default `http://localhost:3001`) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Real Razorpay orders; without them orders get local dev ids |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies `POST /payments/webhooks/razorpay` |
| `CASHFREE_WEBHOOK_SECRET` | Verifies `POST /payments/webhooks/cashfree` |

## Conventions

**Responses.** Every JSON response is `{ data, meta, error }`. Lists that paginate
put `page`, `limit`, `total`, and `totalPages` in `meta` (`?page=&limit=`, max 100).
Errors return `data: null` and `error: { statusCode, message, details }`. Database
errors map to 400 (bad values), 404, or 409 (duplicates or references), never 500.
CSV exports and certificate downloads return raw content.

**Authentication.** Every route needs `Authorization: Bearer <supabase-access-token>`
unless marked `@Public()`. Login accepts an email, a student ID, or a staff profile
ID. Logging out or revoking a session marks it revoked in `user_sessions`, and the
guard rejects its tokens from then on. Five failed logins for one identifier within
15 minutes lock it for 15 minutes.

**Authorization.** Two layers:

1. `@RequirePermissions(...)` checks role permissions plus per-user overrides
   (`/users/:id/permission-overrides`, GRANT or REVOKE).
2. `AccessService` scopes records inside each service: students see their own
   records, parents their linked children, teachers the classes and sections they
   are assigned to, and School Admin, Principal, and Super Admin the whole school.

Seeded roles: Super Admin, School Admin, Principal, Teacher, Accountant, Parent,
Student, Librarian, Transport Staff, Reception. Rerun `npm run prisma:seed` after
pulling changes; it only adds.

**Sensitivity tiers.** Changes follow the architecture document:

| Tier | Behaviour | Examples |
|---|---|---|
| 1 | Applied immediately, audited | Parent edits child contact details |
| 2 | Applied with a required reason, audited | Teacher corrects attendance within 48 hours |
| 3 | Approval request; a School Admin or Principal approves | Older attendance corrections, section transfers, fee structures, discounts, refunds, certificates |
| 4 | Approval request with a supporting document; School Admin and Principal both approve | Student name/DOB/admission number, post-release mark changes, re-opening released results, transfer certificates |

Requests live under `/approval-requests` (`approve`, `reject`, `cancel`, `history`).
A School Admin raising a Tier 4 request fills the School Admin slot; the Principal
completes it. The change is applied in the same transaction as the final approval.

**Audit.** Sensitive mutations append to `audit_logs` (actor, role, old and new
values, reason, approval id, IP, request id). There are no update or delete routes
for audit entries. Search with `/audit-logs`, export with `/audit-logs/export`.

## Modules

| Area | Base routes |
|---|---|
| Auth | `/auth/*` (login, refresh, logout, forgot/reset/change password, OTP, sessions, MFA) |
| Organization | `/organizations`, `/schools`, `/academic-years`, `/classes`, `/sections`, `/subjects` |
| People | `/users`, `/roles`, `/permissions`, `/staff`, `/staff-assignments`, `/students`, `/guardians`, `/me`, `/enrollments` |
| Daily work | `/attendance`, `/homework`, `/announcements`, `/student-leaves`, `/staff-leaves` |
| Academics | `/examinations`, `/marks`, `/students/:id/report-cards`, `/timetables`, `/timetable-slots`, `/substitute-requests` |
| Finance | `/fee-structures`, `/student-fees`, `/payments`, `/payments/webhooks/*`, `/fees/overdue`, `/fees/reports` |
| Communication | `/notifications`, `/notification-preferences`, `/devices`, `/notification-templates`, `/feedback`, `/complaints` |
| Records | `/files`, `/certificates`, `/approval-requests`, `/audit-logs`, `/security-events` |
| Insight | `/dashboards/*`, `/reports/*`, `/analytics/*` |
| Phase 3 | `/transport/*`, `/library/*`, `/assets` |
| Offline | `/sync/*` |

Per-student views: `/students/:id/{attendance,enrollments,homework,report-cards,fee-summary,transport,library-history,history,documents}`.

## Bootstrap accounts

Link an existing Supabase Auth user as Super Admin:

```powershell
npm run prisma:bootstrap-admin -- `
  --auth-user-id=SUPABASE_AUTH_USER_UUID `
  --email=admin@example.com `
  --organization-name="Example Education Group" `
  --organization-slug=example-education `
  --school-name="Example School" `
  --school-code=EXAMPLE-001
```

Create the test organization, school, and admin/teacher/student accounts:

```powershell
npm run prisma:bootstrap-test-accounts -- `
  --admin-password=YOUR_ADMIN_TEST_PASSWORD `
  --teacher-password=YOUR_TEACHER_TEST_PASSWORD `
  --student-password=YOUR_STUDENT_TEST_PASSWORD
```

Staff can also be created in one call with `POST /staff` and a `password`; parents
get logins with `POST /guardians/:id/account`.

## Testing

```powershell
npm run build
npm run lint
$env:RAZORPAY_WEBHOOK_SECRET="dev_webhook_secret"; npm run start:dev
npm run test:e2e
```

`test/e2e/erp-flow.e2e.mjs` drives every module through the live API as the test
admin, teacher, student, and a parent it creates. It reads passwords from
`../test-org-school.txt` (override with `CREDENTIALS_FILE`) and creates its own
academic year each run, so it can be repeated against the dev project.
