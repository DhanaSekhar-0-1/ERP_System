# School ERP Project Status

Single source of truth for what is built, what is partial, and what is known
to be missing. Last updated 2026-11-10.

Related documents:

- [docs/mvp-plan.md](./docs/mvp-plan.md) - **agreed plan for the first school**: roles, approvals, MVP1/2/3 and the MVP1 build order
- [school-erp-architecture.md](./school-erp-architecture.md) - product design, RBAC, sensitivity tiers, roadmap
- [recommended-techstack.md](./recommended-techstack.md) - chosen technology stack
- [API's_modules.md](./API's_modules.md) - target API catalog and sprint order
- [backend/README.md](./backend/README.md) - setup, conventions, and module reference
- [CMD.md](./CMD.md) - local run and test commands

## 1. Architecture

```text
Web (apps/web, React + Vite) and Mobile (apps/mobile, React Native + Expo)
  -> NestJS 11 REST API (backend/src, prefix /api/v1, ~350 routes)
  -> Prisma 6 (DatabaseService extends PrismaClient)
  -> Supabase PostgreSQL (14 migrations, 71 tables)
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
| Prisma schema and migrations | Current (14 migrations) |
| Build / type-check / lint | Passing (`npm run build`, `npm run lint`) |
| End-to-end suite | 529/529 checks passing (`npm run test:e2e`; start the server with `RAZORPAY_WEBHOOK_SECRET=dev_webhook_secret`) |
| Record-level access control | Implemented for all modules |
| Row-Level Security | Enabled on all public tables with no policies; `anon`/`authenticated` have no privileges, so the Supabase Data API is closed. Check with `npm run db:check-rls` |
| Audit logging | Written for every sensitive mutation |
| Approval workflows | Tier 3 and Tier 4 implemented and covered end to end (School Admin + Principal) |
| Redis / BullMQ | Not used; delivery rows are queued in PostgreSQL and sent by `DeliveryWorker` |
| Push / SMS / email providers | **Not verified.** FCM, Twilio and Resend senders are written but have never sent a real message; only the dev console sender is tested |
| Frontend / mobile | Web: leader pages (Overview, Classes & Sections, Teacher Assignments, Exams & Reports, Teachers, Students, Attendance, Approvals, Settings) and a teacher area (My classes, Attendance, Marks entry, Slip tests), checked in the browser on the real API. Mobile: teacher Attendance, Subjects with marks entry, Leave, Notices; student and parent Attendance, Results, Leave, Notices; installs on Android, flows not yet checked on a device. Role-by-role status: [docs/feature-status-by-role.md](./docs/feature-status-by-role.md) |

## 3. Modules

All modules from `API's_modules.md` have APIs. Status reflects end-to-end test coverage.

| Module | Status | Notes |
|---|---|---|
| Authentication and sessions | Done | Login by email/student ID/staff ID, refresh, logout, forgot/reset/change password, OTP, session list and revoke, MFA endpoints, lockout after 5 failures in 15 min |
| Organizations, schools, settings | Done | Super Admin limited to own organization; archived schools blocked. Super Admin has full access (every permission any role has, applied by `npm run prisma:seed`) except that it cannot approve fee discounts, decide staff leave, or give the Principal's Tier 4 approval |
| Users, roles, permissions | Done | Permission overrides, email sync to Supabase, built-in roles cannot be renamed. Only a Super Admin creates, gives or changes Super Admin, School Admin, Principal and Accountant accounts |
| Academic years | Done | Activate, close, rollover (copy structure, optional promotion), summary |
| Classes, sections, subjects | Done | A new class gets Section A; every new section gets its own copy of the school's default subjects (Sanskrit optional and off). Subjects are per section, so renaming or switching one off affects that section only. Delete is refused while students, exams, homework, fees or timetables depend on it; a class keeps at least one section. Web: Classes & Sections with Sections, Subjects, Teacher assignments and Students tabs, and Settings for the default subjects |
| Staff and assignments | Done | One teacher per section subject and one class teacher per section (own table). A section subject can be assigned only in its own section while switched on. Teacher access is read from current assignments on every request, so removing one revokes it at once. Web: Teacher Assignments page |
| Students | Done | Registration by School Admin or Super Admin only, straight into a section with the next roll number and the parent as primary guardian; admission number is the login, first password made from family name and parent mobile and changed at first login; Aadhaar encrypted (AES-256-GCM, `PII_ENCRYPTION_KEY`), shown masked, full only to the student and Accountant; Excel import with a dry run (`POST /students/import`); scoped reads, Tier 4 identity changes, archive/restore, history, documents |
| Guardians and parents | Done | Parent logins, children links, `/me` routes, Tier 1 contact edits |
| Enrollments | Done | Transfer (Tier 3), promote, withdraw |
| Attendance | Done | Daily attendance is marked by the section's class teacher or school leadership; subject teachers can view it. ON_LEAVE status, bulk, 48-hour Tier 2 edits, Tier 3 corrections, summary, CSV export |
| Homework | Done | Section-aware assignment check, grading, return, late flag, archive |
| Announcements | Done | Audience targeting applied on read; publish notifies the audience |
| Examinations and marks | Done | Exam types FA1-FA4 (minor), Q1 Quarterly, Q2 Half-yearly, Q3 Annual (major), Pre-public (Class 10 only), slip tests, and Other. Teachers submit marks; each section is approved by the School Admin once its marks are complete and released by the Principal, independently of other sections (bulk approve-ready and release-approved too). Released marks and report cards show to that section's students, parents and teachers at once; the exam is marked released when every section is. Teachers create slip tests for their own sections, and the School Admin's approval releases them. Tier 3/4 corrections, report cards |
| Fees and payments | Done | Structure approval, refunds (Tier 3), discounts (always a request; only the Principal approves, never their own), receipts, gateway orders, signed idempotent webhooks |
| Leave | Done | Student leave marks ON_LEAVE; staff leave checks balance, is decided only by the Principal (reason needed to reject), and opens substitute requests |
| Timetable and substitutes | Done | Rule-based conflict engine, draft generator, available-teacher ranking |
| Feedback and complaints | Done | Leader-only routing, anonymity, SLA auto-escalation, repeated-complaint alert |
| Notifications | Done | Inbox, preferences, devices, templates, delivery log; delivery worker with FCM/Twilio/Resend senders, retries with backoff, retry/process admin routes. FCM (push), Twilio (SMS) and Resend (email) are **not verified** against the real services |
| Files and certificates | Done | Private storage with signed URLs; certificates are immutable once issued and re-issued as new versions |
| Dashboards, reports, analytics | Done | Principal/teacher/parent/accountant dashboards; rule-based attendance risk |
| Transport, library, assets | Done | NFC boarding events, late-return fines, asset history |
| Offline sync | Done | Replays through normal rules; server-side changes become reviewable conflicts |

## 4. Known gaps

- MFA and OTP need a real authenticator or inbox and are untested.
- Razorpay orders use local dev ids unless `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are set; webhooks require `RAZORPAY_WEBHOOK_SECRET` / `CASHFREE_WEBHOOK_SECRET`.
- **FCM and Twilio are not verified.** The FCM (push) and Twilio (SMS) senders, and the Resend (email) sender, are implemented but have never been run against the real services because there are no credentials yet. The e2e suite only covers the console dev sender. Before relying on them, set `FCM_*`, `TWILIO_*` and `RESEND_API_KEY`/`EMAIL_FROM`, send a test with `POST /notifications/test`, and confirm a SENT row with the provider's message id in `/notification-deliveries`. WhatsApp is not implemented.
- Reports run synchronously with row limits; no background job queue.
- `DIRECT_URL` points at the IPv6-only direct host; on IPv4-only networks use the session pooler URL for migrations.
- Physical NFC cards and readers are untested. `POST /attendance/nfc-scan` is covered end to end by typed card IDs, but no real card has been read, and the phone used so far (Realme RMX3521) has no NFC.

## 5. Next steps

MVP1 is being built on branch `feature/mvp1`, in the order set in
[docs/mvp-plan.md](./docs/mvp-plan.md#5-mvp1-build-order): database changes for the new teacher
and student fields, student creation with admission-number login and Excel import, teacher
registration with app-made IDs, teacher check-in and the attendance dashboard, leave screens,
then hiding the parent login and unused modules, hosting, and a device test. Alongside it:

1. Change the test passwords that are readable in the repository history.
2. A separate client database and hosting for the one-month pilot.
3. Try real cards on an NFC phone.
4. CI pipeline running build, lint, `db:check-rls`, and the e2e suite against a staging project.

Done 2026-11-10: stricter registration checks after testing with 8 correct and 44 wrong or
manipulated rows: names in English letters only, no impossible dates, 14-digit minimum for
slip numbers (catches a mistyped Aadhaar), length limits on the import path, no markup or
leading formula characters in free text, formula-safe logins CSV, and both rows named for
duplicates in a file.

Done 2026-11-10: Excel import script, `npm run import:students` (template, dry run with
sheet row numbers, commit with a logins CSV). Tested end to end against the local API: date
and number cells, blank lines, example rows left in, a blocked commit, re-runs skipping
students already imported, and a sign-in with a printed first password.

Done 2026-11-10: MVP1 student registration (step 4). `POST /students` takes the agreed form;
`POST /students/import` checks or imports Excel rows; students sign in with the admission
number; a generated first password must be changed before any other route works;
`GET /students/:id/aadhaar` shows the full number to the student or Accountant only, logged.
Per-school switches `registration.requireAadhaar` and `registration.requireNfcCard` in school
settings metadata (both on by default) let a pilot run without them.

Done 2026-11-10: MVP1 database fields (migration `20261110100000_mvp1_registration_fields`):
student gender, admission date and type, blood group, mother tongue, PIN code, Aadhaar stored
encrypted with last 4 digits and a duplicate-blocking hash, Aadhaar enrolment slip number,
previous school details; teacher joining date, gender, date of birth, address and subjects
taught; a forced first-password change flag on users; and per-school ID counters for the
Teacher ID. Existing students are marked as already studying here. The API does not use the
new fields yet (MVP1 step 4).

Done 2026-11-10: the MVP plan was agreed ([docs/mvp-plan.md](./docs/mvp-plan.md)). Super Admin
got full access; only a Super Admin creates or changes Principal, School Admin and Accountant
accounts; only the Principal decides staff leave (a rejection needs a reason) and approves fee
discounts and fee structures. Approval requests can be raised only from their own routes (the
general route can no longer lower a Tier 4 change to Tier 3), and someone other than the
requester must approve, except a leader's section transfer.

Done 2026-11-09: class, section, subject and teacher assignment management; per-section exam
approval and release; multi-class exams; teacher web area; local sign-in checks and a short
permission cache to cut per-request cost.

Done 2026-10-28: Principal test account (`npm run prisma:bootstrap-test-accounts -- --only=principal`)
and e2e coverage of Tier 4 approval, rejection, and applied changes.

Done 2026-10-28: notification delivery worker (migration `20261028120000_notification_delivery_worker`).

Done 2026-10-29: Row-Level Security (migration `20261029100000_enable_row_level_security`).
Before it, all 68 tables were readable and writable with the public anon key through the
Supabase Data API; that is now refused for anon and signed-in user tokens.
