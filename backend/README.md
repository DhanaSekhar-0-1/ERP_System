# School ERP backend

## Supabase and Prisma setup

1. Create a Supabase project and open **Project Settings > Database**.
2. Copy the **Session pooler** connection string into `DATABASE_URL`.
3. Copy the **Direct connection** string into `DIRECT_URL`.
4. Replace the password in both URLs. If the password contains characters such
   as `@`, `:`, `/`, or `#`, URL-encode it before saving it.
5. Copy the project URL and keys into the remaining Supabase variables in
   `.env`.
6. Install dependencies and generate Prisma Client:

   ```powershell
   npm install
   npm run prisma:generate
   npm run prisma:validate
   ```

7. Create and apply the first migration from the `backend` directory:

   ```powershell
   npx prisma migrate dev --name initial_foundation
   ```

   For staging or production, apply committed migrations with:

   ```powershell
   npm run prisma:migrate:deploy
   ```

8. Start the API:

   ```powershell
   npm run start:dev
   ```

9. Verify the database connection:

   ```powershell
   Invoke-RestMethod http://localhost:3000/api/v1/health
   ```

   A successful response is:

   ```json
   { "status": "ok", "database": "ok" }
   ```

Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` to a web or mobile
client. Use `.env.example` as the safe configuration template.

## Authentication guard

NestJS protects every route by default with the Supabase access-token guard.
The guard reads:

```http
Authorization: Bearer <supabase-access-token>
```

It validates the token with Supabase Auth using `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, then attaches the authenticated Supabase user to the
request. The `SUPABASE_SERVICE_ROLE_KEY` is not used for request
authentication.

The health route is intentionally public:

```http
GET /api/v1/health
```

The authentication test route is protected:

```http
GET /api/v1/auth-test
```

An unauthenticated request must return `401 Unauthorized`. A route can be
marked public with the `@Public()` decorator. A controller can access the
verified user with `@CurrentUser()`.

The protected current-user route synchronizes the verified Supabase identity
into the ERP `users` table:

```http
GET /api/v1/auth/me
```

The first successful request creates an ERP profile with `INVITED` status.
Organization, school, and role assignment remain separate administrative
steps; authentication alone does not grant ERP permissions.

## Authorization

Authentication and authorization are separate guards. Authentication verifies
the Supabase access token; authorization checks the user's ERP profile, active
status, assigned roles, and role permissions in PostgreSQL.

Protect a route with a permission requirement:

```typescript
@RequirePermissions('students:read')
```

The permission guard requires every listed permission. An authenticated user
without an ERP profile, without `ACTIVE` status, or without the required role
permission receives an appropriate authorization error. No permission is
granted automatically by Supabase authentication.

Seed the initial role and permission catalog with:

```powershell
npm run prisma:seed
```

This command is safe to rerun because it uses upserts. It creates role and
permission definitions but does not assign a role to any user. User activation,
school assignment, and role assignment must be an explicit administrative
workflow.

The backend exposes these public Supabase Auth operations:

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/password-reset/request
```

Registration may require email confirmation depending on the Supabase Auth
project settings. Password reset sends a Supabase recovery email; the client
must handle the recovery link and password update session. Login and refresh
return Supabase session data. Clients should store that session in secure
platform storage and send only its access token to protected NestJS routes.

Student registration also creates a managed login account. The backend
generates the student UUID, creates the Supabase Auth account, assigns the
Student role, and returns the generated student ID as the login identifier.
The submitted password is never stored in the ERP database:

```json
{
  "identifier": "<returned student id>",
  "password": "student-password"
}
```

The same login endpoint accepts a normal email address or a generated staff
profile ID for teacher accounts.
The server-only service-role key is used only for managed account creation.

## Organizations, schools, and settings API

Phase 1 organization and school administration is available through:

```http
GET    /api/v1/organizations
POST   /api/v1/organizations
GET    /api/v1/organizations/:organizationId
PATCH  /api/v1/organizations/:organizationId
GET    /api/v1/organizations/:organizationId/schools
POST   /api/v1/organizations/:organizationId/schools
GET    /api/v1/schools/:schoolId
PATCH  /api/v1/schools/:schoolId
GET    /api/v1/schools/:schoolId/settings
PATCH  /api/v1/schools/:schoolId/settings
POST   /api/v1/schools/:schoolId/archive
POST   /api/v1/schools/:schoolId/restore
```

Organization routes require `organizations:read` or
`organizations:manage`; school routes require `schools:read` or
`schools:manage`. Super Admins can manage all organizations and schools.
Assigned users can read only their own school, and School Admins can manage
only their assigned school. Organization slugs are unique, school codes are
unique within an organization, and archive/restore operations enforce valid
state transitions. School settings are one-to-one with a school and support
address, phone, email, timezone, metadata, and timestamps.

## Users, roles, and permissions API

User administration is scoped to the administrator's organization. Super
Admins can administer all schools in their organization; School Admins can
administer only users assigned to their school. The routes require the
permission shown below:

```http
GET    /api/v1/users                         users:read
POST   /api/v1/users                         users:manage
GET    /api/v1/users/:userId                 users:read
PATCH  /api/v1/users/:userId                 users:manage
POST   /api/v1/users/:userId/activate       users:manage
POST   /api/v1/users/:userId/deactivate     users:manage
POST   /api/v1/users/:userId/invite         users:manage
POST   /api/v1/users/:userId/resend-invite  users:manage
GET    /api/v1/users/:userId/roles           roles:read
POST   /api/v1/users/:userId/roles           roles:manage
DELETE /api/v1/users/:userId/roles/:roleId   roles:manage

GET    /api/v1/roles                         roles:read
POST   /api/v1/roles                         roles:manage
GET    /api/v1/roles/:roleId                 roles:read
PATCH  /api/v1/roles/:roleId                 roles:manage
GET    /api/v1/permissions                   permissions:read
GET    /api/v1/roles/:roleId/permissions     permissions:read
PUT    /api/v1/roles/:roleId/permissions     roles:manage
```

Managed users without a supplied `authUserId` are created through the
server-only Supabase Admin API. Supplying a password creates a confirmed
managed account; omitting it sends an invitation. Passwords are never stored
in PostgreSQL. Deactivation and removal of a School Admin role cannot remove
the last active School Admin for a school, and an administrator cannot
deactivate their own account. Role catalog and permission changes are limited
to Super Admin because roles and permissions are global catalog records.

Session listing and revocation endpoints from the product API specification
are intentionally not exposed yet. The current Supabase integration supports
token validation and account-level managed-user operations, but does not have
a repository-approved session-revocation boundary. Do not implement session
administration by querying or mutating Supabase Auth tables directly; add a
reviewed Supabase Admin session API before exposing those routes.

## Bootstrap the first administrator

After creating a user in Supabase Auth, copy that user's UUID from
**Authentication > Users**. Run this command from `backend` with the real
values:

```powershell
npm run prisma:bootstrap-admin -- `
  --auth-user-id=SUPABASE_AUTH_USER_UUID `
  --email=admin@example.com `
  --organization-name="Example Education Group" `
  --organization-slug=example-education `
  --school-name="Example School" `
  --school-code=EXAMPLE-001
```

The command creates or updates the organization, school, and ERP user,
activates the user, and assigns only the `Super Admin` role. It is idempotent
and does not create a Supabase Auth account; create that account in Supabase
Auth first. Never put the Supabase service-role key in the command or source
code.

## Student API

The first business module is school-scoped student management:

```http
POST  /api/v1/students
GET   /api/v1/students?page=1&limit=25&search=anita
GET   /api/v1/students/:studentId
PATCH /api/v1/students/:studentId
```

Reads require `students:read`; create and update require `students:manage`.
Every query is restricted to the authenticated ERP user's assigned
`schoolId`. Users without an active ERP profile or school assignment cannot
access student records. List responses are paginated and capped at 100 rows.

The next module is school-scoped guardian management:

```http
POST /api/v1/guardians
GET /api/v1/guardians?page=1&limit=25&search=parent
GET /api/v1/guardians/:guardianId
PATCH /api/v1/guardians/:guardianId
POST /api/v1/guardians/:guardianId/students
```

Guardian reads require `guardians:read`; create, update, and student linking
require `guardians:manage`. Student linking validates that both records belong
to the authenticated user's school.

Academic years are the next school-scoped foundation module:

```http
POST /api/v1/academic-years
GET /api/v1/academic-years
GET /api/v1/academic-years/:academicYearId
PATCH /api/v1/academic-years/:academicYearId
POST /api/v1/academic-years/:academicYearId/activate
```

Reads require `academic-years:read`; create, update, and activation require
`academic-years:manage`. Only one academic year per school can be active at a
time, and date ranges must have a start before the end.

Classes are school- and academic-year-scoped:

```http
POST  /api/v1/classes
GET   /api/v1/classes?academicYearId=<uuid>
GET   /api/v1/classes/:classId
PATCH /api/v1/classes/:classId
```

Reads require `classes:read`; create and update require `classes:manage`.
The referenced academic year must belong to the authenticated user's school,
and duplicate class names are rejected within the same academic year.

Sections are scoped to a school and class:

```http
POST  /api/v1/sections
GET   /api/v1/sections?classId=<uuid>
GET   /api/v1/sections/:sectionId
PATCH /api/v1/sections/:sectionId
```

Reads require `sections:read`; create and update require `sections:manage`.
Creation validates that the class and academic year belong to the same school,
and duplicate section names are rejected within a class.

Students must be registered with an NFC identifier:

```json
{
  "admissionNo": "STU-001",
  "nfcId": "04A1B2C3D4",
  "firstName": "Anita",
  "password": "student-password"
}
```

Both an admin and a teacher with `students:manage` can register or update
students. The web or mobile client reads the NFC card using a compatible NFC
reader and sends the normalized card identifier as `nfcId`; the backend does
not directly control the physical NFC device. If a student loses a card,
authorized staff can PATCH a replacement `nfcId`; the login ID and password
remain unchanged.

Staff/teacher NFC registration is admin-only:

```http
POST  /api/v1/staff
GET   /api/v1/staff
GET   /api/v1/staff/:staffId
PATCH /api/v1/staff/:staffId
```

The staff endpoint requires `users:manage`, links an existing Supabase Auth
user to an ERP staff profile, assigns the Teacher role, and stores a unique
employee number and NFC identifier for the school. Create the Supabase Auth
user first; this API does not create passwords or bypass Supabase Auth.
Administrators can replace a lost teacher NFC card through the PATCH endpoint
without changing the teacher's login credentials.

## Enrollments API

```http
POST  /api/v1/enrollments
GET   /api/v1/enrollments?academicYearId=<uuid>&classId=<uuid>
GET   /api/v1/enrollments/:enrollmentId
PATCH /api/v1/enrollments/:enrollmentId
```

Enrollment creation validates that the student, academic year, class, and
section belong to the same school and that the section belongs to the selected
class and academic year. A student can have only one enrollment per academic
year. School Admin has read/manage access; Principal and Teacher have read
access. Enrollment status supports `ACTIVE`, `PROMOTED`, `TRANSFERRED`, and
`WITHDRAWN`.

## Attendance API

```http
POST  /api/v1/attendance
GET   /api/v1/attendance?attendanceDate=2026-09-14
GET   /api/v1/attendance?enrollmentId=<uuid>
GET   /api/v1/attendance/:attendanceId
PATCH /api/v1/attendance/:attendanceId
```

Attendance belongs to an enrollment and is school-scoped. Only one record is
allowed for a student enrollment on a date. Statuses are `PRESENT`, `ABSENT`,
`LATE`, and `EXCUSED`. School Admin and Teacher can manage attendance;
Principal can read it.

## Homework API

```http
GET    /api/v1/homework
POST   /api/v1/homework
GET    /api/v1/homework/:homeworkId
PATCH  /api/v1/homework/:homeworkId
DELETE /api/v1/homework/:homeworkId
POST   /api/v1/homework/:homeworkId/publish
GET    /api/v1/students/:studentId/homework
POST   /api/v1/homework/:homeworkId/submit
```

Homework is scoped to a school, academic year, class, section, subject, and
assigned teacher. The service validates that the teacher has a matching staff
assignment before allowing creation or changes. School Admin and Principal can
manage homework; Teachers can manage their own assigned homework. Published
homework is visible to enrolled students and linked parents, and students can
submit text or an attachment.

## Announcements API

```http
GET    /api/v1/announcements
POST   /api/v1/announcements
GET    /api/v1/announcements/:announcementId
PATCH  /api/v1/announcements/:announcementId
DELETE /api/v1/announcements/:announcementId
POST   /api/v1/announcements/:announcementId/publish
POST   /api/v1/announcements/:announcementId/archive
```

Announcements are school-scoped and support class, section, role, and
arbitrary JSON target metadata. School Admin and Principal can manage them;
Teachers, Students, and Parents can read announcements for their school.

## Subjects API

```http
POST  /api/v1/subjects
GET   /api/v1/subjects?academicYearId=<uuid>
GET   /api/v1/subjects/:subjectId
PATCH /api/v1/subjects/:subjectId
```

Subjects are scoped to the authenticated user's school and academic year.
Reads require `subjects:read`; create and update require `subjects:manage`.
Subject codes are normalized to uppercase and must be unique within a school
and academic year.

## Test accounts

The seeded roles are not test users by themselves. To create a dedicated
Supabase/ERP test organization, school, and three linked accounts, run:

```powershell
npm run prisma:bootstrap-test-accounts -- `
  --admin-password=YOUR_ADMIN_TEST_PASSWORD `
  --teacher-password=YOUR_TEACHER_TEST_PASSWORD `
  --student-password=YOUR_STUDENT_TEST_PASSWORD
```

The script is idempotent for the default test emails and creates:

```text
test.admin@erp.local    -> School Admin
test.teacher@erp.local  -> Teacher
test.student@erp.local  -> Student
```

It also creates a test student profile with a generated student ID and
`TEST-NFC-STUDENT-001`, plus a teacher profile with
`TEST-NFC-TEACHER-001`. Passwords come from command-line options or are
generated for one-time display; never commit them to source control.
