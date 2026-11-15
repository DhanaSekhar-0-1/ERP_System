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

## 0. Resume here (updated 2026-11-13)

**Branch:** `feature/mvp1` (pushed; see `git log` for the last commit). `main` is at `7d83a52` and has none
of the MVP1 work yet. Never push MVP1 work to `main` directly.

**MVP1 progress** (full table in [docs/mvp-plan.md](./docs/mvp-plan.md#5-mvp1-build-order)):
steps 1–7 are done; **step 8 is next**.

| Step | What | Commit |
|---|---|---|
| 2, 2a | Account rules (Super Admin-only senior accounts), Principal-only staff leave and discounts, approval loophole closed | `c66f3c0`, `ccd1465` |
| 3 | MVP1 database fields | `952f8ca` |
| 4 | Student registration, admission-number login, Excel import endpoint; hardening | `0f03b80`, `81da79b` |
| 4+ | Excel import script `npm run import:students` | `32b2627` |
| 5, 5a | Teacher registration (Teacher ID T26A05); choose-your-own-password screen (web + phone) | `62d4214`, `d7146aa` |
| 6a, 6b | Teacher check-in/out at school; Admin attendance dashboard and student details page | `8ba0b80`, `9174298` |
| 7 | Leave: teacher requests on phone and web with half days, Principal decides on the web, class teachers decide student leave on the web too, Admin sees who is away; no leave limits in MVP1 | `1be2665` |
| 8a | Module switches per school in web Settings (server-enforced; "Use the MVP1 set"; parent login off; Aadhaar/NFC registration switches) | `aa6b221` |
| 8b | Hosting: `render.yaml` (Render Free, Singapore; migrations, RLS check and role seed run in the build), `apps/web/vercel.json`, `npm run pilot:setup` (school, year, MVP1 switches, first logins) and [docs/hosting-guide.md](./docs/hosting-guide.md) | `17e9ea9` |
| 8c | Android APK: `apps/mobile/eas.json` (`pilot` profile, APK, Render API address), [docs/android-apk-guide.md](./docs/android-apk-guide.md), [docs/device-test-checklist.md](./docs/device-test-checklist.md); the phone scan screen always shows a focused Card ID box that submits on Enter (USB/OTG readers) | this step's commit |

**Test data (decided 2026-11-13):** the development database is **not** cleaned; nothing is
deleted. Teacher "ravikatari" (42124) is the user's own and must be kept. A trial school "Pilot Trial School" (PILOT-TEST, logins `pilot.*@erp.local`) was made on 2026-11-13 to test `pilot:setup`; it is kept like the rest. Agreed for later: make
the e2e suite reuse one test parent and deactivate/archive what each run creates.

**Resume here (stopped 2026-11-14):** hosting is live and a demo school exists; the next job is
the **Android APK**. State:
- Expo: signed in on this computer as `dhana9572` (Google account; use `npx eas-cli@latest login
  --device` if asked again). App linked as `@dhana9572/school-erp` (projectId in
  `apps/mobile/app.json`, commit `0f49669`). Android signing key created and kept by Expo.
- A first build (`744883b5-9713-48ec-bb67-f8f31438ab9c`, profile `pilot`) was queued on 2026-11-14 and
  left running. Its upload wrongly included the stale local `apps/mobile/android` folder (1.4 GB), so
  it may not reflect `app.json` (e.g. the location permission). Since then the root `.gitignore`
  excludes that folder (`97212fd`). Do not use this build.
- **Fresh build done 2026-11-15:** `efd8117d-5099-4041-b25c-111368e98c91` (profile `pilot`, version
  code 3, from `e04784f`). Upload was 2.2 MB, the log has a PREBUILD phase, and the installed app
  requests NFC and location. Page:
  https://expo.dev/accounts/dhana9572/projects/school-erp/builds/efd8117d-5099-4041-b25c-111368e98c91
  (the APK link there expires 2026-11-29).
- Installed over USB on the Realme 9 4G (RMX3521, Android 14) after removing an old debug build
  from 2026-11-04. It opens to the sign-in screen and Server settings shows the Render address.
- **Current build on the phone: `a80b9712-8aff-4e20-8463-22df0a3e16a4`** (version code 4, from
  `4ed73a0`), which adds a show/hide eye button to the password boxes; checked on the phone's
  sign-in screen. Use this build for the device test.
- 2026-11-15 web check on the **local** app with the dev test accounts (`test-org-school.txt`):
  Teacher (attendance save, leave send and cancel), School Admin, Principal, Super Admin (all
  pages open) and Student (sent to the phone app) all sign in. Seen and not yet fixed: the
  dashboard counts all 97 students as "to mark" while the Attendance page counts only students in
  a section; no "server is waking up" message on the phone; the sign-in error says "Invalid email
  or password" although IDs are accepted too.
  **Next: docs/device-test-checklist.md** — first add a class, a test teacher and two test students
  to the demo school on the web (it only has the three admin logins so far).
- Demo school logins (first passwords) are in git-ignored `pilot-first-logins.txt`.

**Pilot hosting (set up 2026-11-14):** web https://school-erp-tan-zeta.vercel.app (Vercel project
`school-erp`, root `apps/web`, deploys from `main`); API https://school-erp-api-stf8.onrender.com
(Render Blueprint `school-erp`, service `school-erp-api`, Free, Singapore, deploys `feature/mvp1`,
auto-deploy off); database: Supabase project `school-erp-copilot` (`nzvucrhdhxibliytyiwn`, Mumbai),
public sign-ups off. Local settings in `backend/.env.pilot` (git-ignored). `CORS_ORIGINS` is the
Vercel address. Demo school created 2026-11-14 ("Demo Public School", DEMO; first passwords in git-ignored `pilot-first-logins.txt`). Not done yet: the real school, the APK build.
`feature/mvp1` was merged into `main` by the user (PR #4).

**MVP1 is built — start here.** Steps 1–8c are done. What remains is the user's own setup and
testing, in this order: (1) follow [docs/hosting-guide.md](./docs/hosting-guide.md) (Supabase,
Render, Vercel, `npm run pilot:setup`); (2) build the APK with
[docs/android-apk-guide.md](./docs/android-apk-guide.md) (`eas init` adds a `projectId` to
`apps/mobile/app.json`; commit it); (3) run [docs/device-test-checklist.md](./docs/device-test-checklist.md)
on a real phone, including NFC with the OTG reader (card numbers must match the reader used at
registration). Developer tasks before the pilot: fix
anything the device test finds, and the agreed e2e tidy-up (reuse one test parent).

**How to run and test** (details in [CMD.md](./CMD.md) and `.claude/launch.json`):

- Backend `npm run build` then start (`backend` launch config sets `RAZORPAY_WEBHOOK_SECRET`);
  web on port 3001 (`web`); phone app web preview on 8081 (`mobile-web-preview`).
- `backend/.env` must have `PII_ENCRYPTION_KEY` (Aadhaar encryption; local only, keep a backup).
- Test accounts are in `test-org-school.txt` (repository root). After pulling, run
  `npm run prisma:migrate:deploy` and `npm run prisma:seed` in `backend`.
- e2e: `npm run test:e2e` in `backend` against a running server (628 checks, about 3–10 minutes).
  The suite is one long scenario and cannot run a single section yet.

**Working agreements with the user:**

- Write decisions into the docs (mainly `docs/mvp-plan.md`) before building a step; ask the user
  when the plan does not settle something, with a recommended option.
- While building, test only the related APIs and screens (plus type-check and a browser
  check); run the full e2e suite once before each commit.
- One commit per step on `feature/mvp1`, pushed to that branch; update STATUS and the role docs
  in the same commit.

**Open items to remember:**

- Packages updated 2026-11-13 (`npm audit fix`, no breaking changes): the critical
  `proxy-addr` and the high `multer`/`@nestjs/platform-express` issues are fixed. Left on purpose:
  `deepmerge-ts` (high) inside the Prisma 6 CLI config loader, fixed only in Prisma 7, a major
  upgrade; it runs at build/migrate time, not while the API serves requests. Dev-only build tools
  (moderate/low) and Expo's build-time `minimatch` (its fix would downgrade Expo to 52) also stay.
  Revisit with the Prisma 7 upgrade after the pilot.
- The development database holds many test records from e2e runs (teachers, `QA-…` and
  `SCR-…` students). The test student now has 41 parent links, so every results notification
  goes to ~40 parents; the queue of deliveries can then delay the e2e notification checks
  (seen 2026-11-13: they failed until the queue drained, then 613/613 passed) and makes the
  suite slower. Cleaning the old test parents, or making the suite reuse one, would fix it.
- A run that crosses midnight once made the late check-in test fail; the test now works out
  the expected status from the actual check-in time.
- A fake-location app can cheat teacher check-in; the dashboard and corrections are the check.
- Schools must have their time zone set (Asia/Kolkata is used when it is not).
- Not tested on a real phone yet: phone screens, check-in at school, NFC cards.
- Teacher leave has no limits in MVP1 (user's choice); allowances can be switched on later with
  `leave.enforceBalance` in school settings.

## 1. Architecture

```text
Web (apps/web, React + Vite) and Mobile (apps/mobile, React Native + Expo)
  -> NestJS 11 REST API (backend/src, prefix /api/v1, ~350 routes)
  -> Prisma 6 (DatabaseService extends PrismaClient)
  -> Supabase PostgreSQL (16 migrations, 72 tables)
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
| Prisma schema and migrations | Current (16 migrations) |
| Build / type-check / lint | Passing (`npm run build`, `npm run lint`) |
| End-to-end suite | 628/628 checks passing (`npm run test:e2e`; start the server with `RAZORPAY_WEBHOOK_SECRET=dev_webhook_secret`) |
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
| Leave | Done | Student leave marks ON_LEAVE and is decided by the class teacher (phone and web); teacher leave can be a morning or afternoon half day, is decided only by the Principal (reason needed to reject), and opens substitute requests; no leave limits unless `leave.enforceBalance` is set. Web Leave pages for leaders and teachers; phone Leave tab for teachers |
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
[docs/mvp-plan.md](./docs/mvp-plan.md#5-mvp1-build-order). Steps 1–6b are done; next are the
leave screens (step 7), then hiding the parent login and unused modules, hosting, and a device
test (step 8). See section 0 above for where to resume. Alongside it:

1. ~~Update the server packages flagged by `npm audit`~~ Done 2026-11-13 (see open items).
2. Change the test passwords that are readable in the repository history.
3. A separate client database and hosting for the one-month pilot.
4. Try real cards on an NFC phone, and a real check-in at school.
5. Split the e2e suite so one area can run on its own (offered to the user, not started).
6. CI pipeline running build, lint, `db:check-rls`, and the e2e suite against a staging project.

Done 2026-11-13: leave (step 7). Teachers ask for leave on the phone and the web, with a
morning or afternoon half day for one date (0.5 days); no leave limits in MVP1; the Principal
approves or rejects on the web (reason required); class teachers decide student leave on the
web too; the Admin sees who is away today and in the coming days. A morning half day is not
marked late at check-in, and the dashboard shows the half. Checked: the API rules, the teacher
and Principal web pages (request, reject with reason), and the phone Leave tab (history with
the Principal's reason).

Done 2026-11-10: Admin attendance dashboard (step 6b). The web Attendance page now shows the
day across the school (summary tiles), Teachers today with corrections, every section of the
active year (present, absent, on leave, not marked, %), a section's students with today's
status and year-to-date %, and links to a new student details page with monthly attendance per
year. Checked in the browser: a correction (Divya Rao, Present 08:50, reason shown), Class 8-A
students (66.7% shown in red), and a student's details page.

Done 2026-11-10: teacher check-in and check-out (step 6a). Teachers check in and out on the
phone only within the school's radius (default 200 m; readings rougher than 150 m refused),
Late after the school's set time, once a day each, never on approved leave. School Admin or
Super Admin corrects a day with a reason; the day's list shows Present, Late, On leave, Absent
or Not checked in with a summary. Settings card on the web Settings page. Checked in the
browser: settings saved and read back; phone card before and after check-in (Late, In at 21:22,
Check out); a refused location shows a clear message.

Done 2026-11-10: "Choose your own password" screen in the web and phone apps (step 5a). After a
sign-in with a first password the app shows only this screen until the password is changed,
then continues to the person's normal screens. The same rules on both (at least 8 characters,
a letter and a number, different from the first password, typed twice) come from
`newPasswordProblem` in `packages/shared`. Checked in the browser on web (teacher T26A24) and in
the phone app's web preview (teacher T26A25).

Done 2026-11-10: MVP1 teacher registration (step 5). `POST /staff` takes the MVP1 form, makes
the Teacher ID (T26A05) from the school's counter and a random first password shown once, and
checks subjects against the school's list; teachers sign in with the Teacher ID (or email). Web
Teachers page dialog rebuilt and checked in the browser (registered T26A23). Login screens now
say "Admission number, Teacher ID or email". The "choose a new password" screen
followed the same day (below).

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
