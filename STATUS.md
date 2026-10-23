# School ERP Project Status

Single source of truth for what is built, what is partial, and what is known
to be missing. Last updated 2026-10-23.

Related documents:

- [school-erp-architecture.md](./school-erp-architecture.md) - product design, RBAC, sensitivity tiers, roadmap
- [recommended-techstack.md](./recommended-techstack.md) - chosen technology stack
- [API's_modules.md](./API's_modules.md) - target API catalog and sprint order
- [backend/README.md](./backend/README.md) - setup, conventions, and module reference
- [CMD.md](./CMD.md) - local run and test commands

## 1. Architecture

```text
Web/Mobile (not started - planned Next.js + React Native/Expo)
  -> NestJS 11 REST API (backend/src, prefix /api/v1, ~350 routes)
  -> Prisma 6 (DatabaseService extends PrismaClient)
  -> Supabase PostgreSQL (8 migrations, ~70 tables)
  -> Supabase Auth (identity) + Supabase Storage (private files, bucket erp-files)
```

Request pipeline: request-context middleware (request id, IP) -> `SupabaseAuthGuard`
(token + server-side session revocation) -> `AuthorizationGuard` (role permissions
plus per-user overrides) -> service-level record scoping via `AccessService`
-> `{ data, meta, error }` response envelope and a global exception filter.

Shared services in `src/common`:

| Service | Purpose |
|---|---|
| `AccessService` | Caller context and record-level scope: students see themselves, parents their linked children, teachers their assigned classes/sections, leaders the whole school |
| `AuditService` | Append-only audit entries with actor, role, old/new values, reason, request id, IP |
| `ApprovalEngine` | Tier 3 (School Admin or Principal) and Tier 4 (both, document required) requests; registered handlers apply the change on final approval |
| `NotifyService` | In-app notifications plus queued push/SMS/email delivery rows per user preference |

## 2. Platform status

| Area | Status |
|---|---|
| Prisma schema and migrations | Current (8 migrations) |
| Build / type-check / lint | Passing (`npm run build`, `npm run lint`) |
| End-to-end suite | 277/277 checks passing (`npm run test:e2e`) |
| Record-level access control | Implemented for all modules |
| Audit logging | Written for every sensitive mutation |
| Approval workflows | Tier 3 and Tier 4 implemented |
| Redis / BullMQ | Not used; delivery rows are queued in PostgreSQL |
| Frontend / mobile | Not started |

## 3. Modules

All modules from `API's_modules.md` have APIs. Status reflects end-to-end test coverage.

| Module | Status | Notes |
|---|---|---|
| Authentication and sessions | Done | Login by email/student ID/staff ID, refresh, logout, forgot/reset/change password, OTP, session list and revoke, MFA endpoints, lockout after 5 failures in 15 min |
| Organizations, schools, settings | Done | Super Admin limited to own organization; archived schools blocked |
| Users, roles, permissions | Done | Permission overrides, email sync to Supabase, built-in roles cannot be renamed |
| Academic years | Done | Activate, close, rollover (copy structure, optional promotion), summary |
| Classes, sections, subjects | Done | Section archive |
| Staff and assignments | Done | Section-level assignments, class teacher flag, activate/deactivate |
| Students | Done | Scoped reads, Tier 4 identity changes, archive/restore, history, documents |
| Guardians and parents | Done | Parent logins, children links, `/me` routes, Tier 1 contact edits |
| Enrollments | Done | Transfer (Tier 3), promote, withdraw |
| Attendance | Done | ON_LEAVE status, bulk, 48-hour Tier 2 edits, Tier 3 corrections, summary, CSV export |
| Homework | Done | Section-aware assignment check, grading, return, late flag, archive |
| Announcements | Done | Audience targeting applied on read; publish notifies the audience |
| Examinations and marks | Done | Draft -> Verified -> Locked -> Released, Tier 3/4 corrections, report cards |
| Fees and payments | Done | Structure approval, discounts and refunds (Tier 3), receipts, gateway orders, signed idempotent webhooks |
| Leave | Done | Student leave marks ON_LEAVE; staff leave checks balance and opens substitute requests |
| Timetable and substitutes | Done | Rule-based conflict engine, draft generator, available-teacher ranking |
| Feedback and complaints | Done | Leader-only routing, anonymity, SLA auto-escalation, repeated-complaint alert |
| Notifications | Done | Inbox, preferences, devices, templates, delivery log |
| Files and certificates | Done | Private storage with signed URLs; certificates are immutable once issued and re-issued as new versions |
| Dashboards, reports, analytics | Done | Principal/teacher/parent/accountant dashboards; rule-based attendance risk |
| Transport, library, assets | Done | NFC boarding events, late-return fines, asset history |
| Offline sync | Done | Replays through normal rules; server-side changes become reviewable conflicts |

## 4. Known gaps

- Principal approval of Tier 4 requests is not covered by the e2e suite (no Principal test account).
- MFA and OTP need a real authenticator or inbox and are untested.
- Razorpay orders use local dev ids unless `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are set; webhooks require `RAZORPAY_WEBHOOK_SECRET` / `CASHFREE_WEBHOOK_SECRET`.
- Push, SMS, email and WhatsApp delivery: rows are queued, no sender worker or provider yet.
- Reports run synchronously with row limits; no background job queue.
- Row-Level Security for direct Supabase Data API access is not enabled.
- `DIRECT_URL` points at the IPv6-only direct host; on IPv4-only networks use the session pooler URL for migrations.
- Physical NFC readers are untested; NFC capture UI does not exist.

## 5. Next steps

1. Create a Principal test account and extend the e2e suite to Tier 4 approvals.
2. Notification delivery worker (FCM, SMS gateway) with a queue.
3. Row-Level Security policies.
4. Frontend (Next.js) and mobile (Expo) against this API.
5. CI pipeline running build, lint, and the e2e suite against a staging project.
