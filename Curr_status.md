# Current Project Status

## Platform

| Area | Status |
|---|---|
| Supabase project | Ready |
| Supabase PostgreSQL | Connected |
| Prisma schema | Valid |
| Prisma migrations | Applied and current |
| NestJS backend | Starts successfully |
| Health endpoint | Working; database reports `ok` |
| Supabase Auth | Integrated |
| RBAC and permissions | Implemented and seeded |
| Frontend/mobile applications | Not started |

## Completed backend modules

- Authentication and Supabase session flows
- Global authentication and permission guards
- Academic years
- Classes and sections
- Subjects
- Students and generated student login IDs
- NFC identity registration and replacement for students and teachers
- Guardians and student links
- Staff/teacher registration
- Staff assignments
- Student enrollments
- Attendance
- Homework and student submissions
- Announcements, publishing, and archiving

## Sprint status

- Sprints 2-5 core MVP functionality: complete.
- Sprint 6 (Homework and Announcements): complete.
- Sprint 1 platform foundation: partially complete; audit APIs and approval
  APIs remain. Organization, school, user, role, and permission management
  APIs are complete. Session administration remains intentionally bounded
  until a reviewed Supabase Admin session-revocation API is available.
- Sprint 7 (Examinations and Marks): next planned backend module.

## Latest verification

- `npm run prisma:migrate:deploy`: passed; no pending migrations.
- `npm run prisma:validate`: passed.
- `npm run prisma:seed`: passed.
- `npm run build`: passed.
- `GET /api/v1/health`: database `ok`.
- Anonymous Homework and Announcements requests: correctly return `401`.
- Real Admin, Teacher, and Student authentication was previously verified.
- Users, roles, permissions, invitations, role assignments, scope checks, and
  last-active-School-Admin protection are implemented.

## Remaining boundaries

- No frontend/mobile NFC capture UI.
- No physical NFC reader test in this repository.
- No complete automated integration/E2E suite.
- Audit writes are not yet automatic for every sensitive mutation.
- Session listing/revocation APIs are intentionally not exposed; the current
  integration does not provide a reviewed safe server-side session boundary.
- RLS hardening for direct Supabase Data API access remains pending.
