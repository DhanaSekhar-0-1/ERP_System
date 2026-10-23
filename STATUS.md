# School ERP Project Status

Single source of truth for what is built, what is partial, and what is known
to be wrong. Replaces the former `Curr_status.md`, `status-project.md`, and
`backend/about.md`.

Related documents:

- [school-erp-architecture.md](./school-erp-architecture.md) - product design, RBAC, sensitivity tiers, roadmap
- [recommended-techstack.md](./recommended-techstack.md) - chosen technology stack
- [API's_modules.md](./API's_modules.md) - target API catalog and sprint order
- [backend/README.md](./backend/README.md) - setup and per-module API reference
- [CMD.md](./CMD.md) - local run and test commands

## 1. Architecture

```text
Web/Mobile (not started - planned Next.js + React Native/Expo)
  -> NestJS 11 REST API (backend/src, global prefix api/v1)
  -> Prisma 6 (DatabaseService extends PrismaClient)
  -> Supabase PostgreSQL (DATABASE_URL pooler :6543 runtime, DIRECT_URL :5432 migrations)
  -> Supabase Auth (passwords and tokens; service-role key is server-only)
```

- Supabase Auth manages identity and passwords. NestJS manages ERP profiles,
  school scoping, roles, permissions, and business rules.
- `SupabaseAuthGuard` (global) validates `Authorization: Bearer <token>`;
  `@Public()` bypasses it.
- `AuthorizationGuard` (global) checks `users.status = ACTIVE` and role
  permissions declared with `@RequirePermissions(...)`.
- Database: 7 migrations, 24 models, migration status current.
- Seed (`prisma/seed.ts`) upserts 7 roles: Super Admin, School Admin,
  Principal, Teacher, Accountant, Parent, Student, plus the permission catalog.
- Scripts: `bootstrap-admin.ts` links an existing Supabase Auth user as Super
  Admin; `bootstrap-test-accounts.ts` creates `test.admin`, `test.teacher`, and
  `test.student@erp.local` with `TEST-NFC-*` identifiers.

## 2. Platform status

| Area | Status |
|---|---|
| Supabase project and PostgreSQL | Connected |
| Prisma schema and migrations | Valid, applied, current |
| NestJS backend | Builds and starts; `tsc --noEmit` passes |
| Health endpoint | `GET /api/v1/health` returns database `ok` |
| Supabase Auth | Integrated |
| RBAC and permissions | Implemented and seeded (role-level only, see section 6) |
| Audit logging | Tables exist; nothing writes to them |
| Approval workflows | Tables exist; no APIs |
| Redis / BullMQ | Not used (`REDIS_URL` is unused) |
| Automated tests | None (`test/e2e`, `test/integration` are empty) |
| Lint | `npm run lint` fails: no `eslint.config.*` |
| Frontend / mobile | Not started |

## 3. Completed modules

All routes are under `/api/v1`. Full request details are in
[backend/README.md](./backend/README.md).

| Module | Routes | Notes |
|---|---|---|
| Health | `GET /health`, `GET /auth-test`, `GET /authorization-test` | Health is public |
| Organizations | `GET/POST /organizations`, `GET/PATCH /organizations/:id`, `GET/POST /organizations/:id/schools` | Unique slug; Super Admin only for manage |
| Schools and settings | `GET/PATCH /schools/:id`, `GET/PATCH /schools/:id/settings`, `POST /schools/:id/archive`, `POST /schools/:id/restore` | One-to-one settings; state-transition checks |
| Users | `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/{activate,deactivate,invite,resend-invite}`, `GET/POST /users/:id/roles`, `DELETE /users/:id/roles/:roleId` | Self-deactivation blocked; last active School Admin protected |
| Roles and permissions | `GET/POST /roles`, `GET/PATCH /roles/:id`, `GET/PUT /roles/:id/permissions`, `GET /permissions` | Catalog changes are Super Admin only |
| Classes, sections, subjects | `POST/GET /classes`, `GET/PATCH /classes/:id` (same shape for sections and subjects) | Duplicate-name/code protection; subject codes uppercased |
| Guardians | `POST/GET /guardians`, `GET/PATCH /guardians/:id`, `POST /guardians/:id/students` | Same-school link validation |
| Staff | `POST/GET /staff`, `GET/PATCH /staff/:id` | Links existing Auth user; assigns Teacher; unique employee number and NFC |
| Staff assignments | `POST/GET /staff-assignments`, `DELETE /staff-assignments/:id` | Teacher + class + subject + year |
| Homework | `GET/POST /homework`, `GET/PATCH/DELETE /homework/:id`, `POST /homework/:id/{publish,submit}`, `GET /students/:id/homework` | Teacher-assignment validation; one submission per student |
| Announcements | `GET/POST /announcements`, `GET/PATCH/DELETE /announcements/:id`, `POST /announcements/:id/{publish,archive}` | Class/section/role targeting stored |

## 4. Partial modules

### Authentication and sessions

Done: `POST /auth/register`, `POST /auth/login` (email, student ID, or staff
profile ID), `POST /auth/refresh`, `POST /auth/password-reset/request`,
`GET /auth/me`.

Pending: `logout`, `forgot-password`/`reset-password` (spec names),
`send-otp`, `verify-otp`, `verify-email`, `change-password`, MFA setup/verify/
disable, session list/revoke, Redis login rate limits, `login_attempts` table.
Session administration is intentionally deferred until a reviewed Supabase
Admin session API exists; do not query or mutate Supabase Auth tables directly.

### Academic years

Done: create, list, read, update, `POST /academic-years/:id/activate`
(transactional, one active per school).
Pending: `close`, `rollover`, `summary`.

### Students

Done: create (generates student ID used as login ID; creates managed Auth
account; requires NFC ID), list with search and pagination, read, update
(including NFC replacement).
Pending: archive, restore, history, documents, and per-student attendance,
report-card, fee, transport, and library views.

### Enrollments

Done: `POST/GET /enrollments`, `GET/PATCH /enrollments/:id`; one enrollment
per student per year; statuses `ACTIVE`, `PROMOTED`, `TRANSFERRED`, `WITHDRAWN`.
Pending: `/students/:id/enrollments`, `transfer`, `promote`, `withdraw` actions.

### Attendance

Done: `POST/GET /attendance`, `GET/PATCH /attendance/:id`; one record per
enrollment per date; statuses `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`.
Pending: `bulk`, `correction-request`, `summary`, `export`,
`/sections/:id/attendance`, offline sync, and the `ON_LEAVE` status.

### Audit and approvals

Tables `audit_logs` and `approval_requests` exist and the seed defines
`audit:read` and `approvals:*`, but there are no APIs and no code writes
audit entries.

## 5. Not started

Examinations and marks (next, Sprint 7), fees and payments (Sprint 8), files
and certificates, leave management, timetable, substitutes, feedback and
complaints, notifications, dashboards and reports, transport, library,
inventory, analytics, offline sync.

Empty placeholder directories exist for: `src/modules/{approvals,audit,auth,dashboards,examinations,fees,files,marks,notifications}`,
`src/workers/{notifications,payments,reports}`,
`src/common/{decorators,filters,guards,interceptors,pipes,redis}`.

Spec tables not yet in the schema: `permission_overrides`, `user_sessions`,
`login_attempts`, `file_assets`, `notifications`, `notification_preferences`.

## 6. Known issues (code review, 2026-10-23)

### Critical - authorization

1. **No record-level scoping.** Services filter only by `schoolId`. Because the
   seed grants Student and Parent `students:read`, `guardians:read`,
   `attendance:read`, and `homework:read`, any student or parent can list every
   student, every guardian phone number, all attendance, all homework including
   drafts and other students' submissions, and draft/archived announcements.
   Announcement targeting is never applied on read.
2. **Teachers are not limited to assigned classes.** Teacher holds
   `students:manage` and `attendance:manage`, so a teacher can edit any
   student's name and date of birth (Tier 4 in the spec) and any attendance
   record on any date.
3. **Super Admin is not organization-scoped** in `organizations.service.ts` and
   `schools.service.ts` (it is in `users.service.ts`).
4. **No audit writes** for any mutation, including role and permission changes.

### High - correctness

5. Homework resubmission resets a `GRADED` submission to `SUBMITTED`; late
   submissions are accepted.
6. `findForStudent` orders enrollments by UUID, so a student with two `ACTIVE`
   enrollments gets an arbitrary year's homework.
7. Changing a user's email updates only the ERP table (`updateManagedUser` is
   unused); staff-ID login then resolves to an email Supabase does not know.
8. `School.isArchived` is never enforced; archived-school users keep access.
9. Unvalidated `@Query()` filters (UUIDs and dates) return 500 instead of 400.
10. Authorization depends on role *names*; renaming "School Admin" or
    "Super Admin" breaks it.
11. Staff creation does not verify `authUserId`/`email` against Supabase and can
    reactivate a suspended user.

### Medium - schema and platform

- Cascading deletes remove history (academic year -> homework/assignments;
  enrollment -> attendance); homework and announcements are hard-deleted.
- `StaffAssignment` has no section, so section-level teacher scope is impossible.
- Many tables lack `createdAt`/`updatedAt`; `ApprovalRequest.status` is a string.
- Only students and guardians are paginated.
- No rate limiting, CORS config, helmet, global exception filter, or
  `{data, meta, error}` response envelope.
- Scope helpers (`getSchoolId`, `getActor`, `isUniqueError`) are duplicated in
  about 15 services.

### Environment boundaries

- Physical NFC readers are untested; NFC capture UI does not exist.
- Row-Level Security is not enabled for direct Supabase Data API access.

## 7. Recommended next steps

1. Shared record-level access service (student self, parent linked children,
   teacher assignments) applied to every module; tighten the seed.
2. Fix the correctness bugs in section 6 (High).
3. Audit writes on every sensitive mutation, then approval workflow APIs.
4. Schema migration: `ON_LEAVE`, section on staff assignments, timestamps,
   restrictive delete rules.
5. Sprint 7 examinations and marks; Sprint 8 fees.
6. ESLint config, Jest, and an integration test suite.
7. Sessions, MFA, OTP, and Redis rate limits.
8. Frontend (Next.js) and mobile (Expo) once the above is stable.
