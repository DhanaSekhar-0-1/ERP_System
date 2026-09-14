# School ERP Project Status

## Current architecture

```text
Web/mobile client -> NestJS API -> Prisma -> Supabase PostgreSQL
                                  -> Supabase Auth
```

Supabase Auth manages identity and passwords. NestJS manages ERP profiles,
school scoping, roles, permissions, and business rules. Prisma manages the
PostgreSQL schema, migrations, and queries.

## Completed modules

### Database foundation

- Prisma schema connected to Supabase PostgreSQL.
- Runtime pooler URL and direct migration URL configured.
- Initial foundation migration applied.
- Foundation tables include organizations, schools, users, roles, permissions,
  academic years, classes, sections, subjects, students, guardians, staff,
  enrollments, audit logs, and approval requests.
- NFC columns exist for students and staff.
- Students can link to ERP user identities.
- Homework, homework submissions, and announcements tables are migrated.
- Migration status is current.

### Organizations, schools, and settings

Completed Phase 1 administration APIs:

- Organization list/create/read/update with unique slug validation.
- Organization school list/create with organization-scoped school-code
  uniqueness.
- School read/update/archive/restore routes with state-transition checks.
- One-to-one school settings read/update with address, phone, email, timezone,
  metadata JSON, and created/updated timestamps.
- Permission enforcement for `organizations:read`,
  `organizations:manage`, `schools:read`, and `schools:manage`.
- Super Admin cross-organization management and assigned-school restrictions
  for school users and School Admins.

### Health

```http
GET /api/v1/health
```

Returns backend and database status.

### Authentication

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/password-reset/request
GET  /api/v1/auth/me
```

Completed:

- Global Supabase Bearer-token guard.
- Public-route support.
- Supabase Auth registration, login, refresh, and password reset request.
- Login by email, student ID, or staff profile ID.
- Server-side managed student Auth account creation.
- Student ID and password login.
- ERP user synchronization.
- Student role assignment for managed student accounts.

### Authorization

- Global permission guard.
- `@RequirePermissions(...)`.
- Active ERP user validation.
- School assignment validation.
- Seeded roles:
  - Super Admin
  - School Admin
  - Principal
  - Teacher
  - Accountant
  - Parent
  - Student

### Users, roles, and permissions

Completed organization/school-scoped administration APIs:

- User CRUD, activation/deactivation, invitation, and resend-invite routes.
- Role CRUD, permission catalog listing, and role-permission replacement.
- User role listing, assignment, and removal.
- `users:read`, `users:manage`, `roles:read`, `roles:manage`, and
  `permissions:read` enforcement.
- Super Admin organization scope and School Admin assigned-school scope.
- Self-deactivation prevention and last active School Admin protection.
- Server-only Supabase Admin API use for managed account creation and invites.

Session listing and revocation remain intentionally deferred because the
current integration has no reviewed safe server-side session administration
boundary. Audit APIs and automatic audit writes are also still pending.

### Students

```http
POST  /api/v1/students
GET   /api/v1/students
GET   /api/v1/students/:studentId
PATCH /api/v1/students/:studentId
```

Completed:

- School-scoped CRUD.
- Pagination and search.
- Admission-number uniqueness.
- Required NFC ID for registration.
- Generated student ID used as login ID.
- Password handled by Supabase Auth and never stored in ERP tables.
- Student NFC replacement without changing login credentials.
- Cross-check preventing a student NFC ID from matching staff NFC.

Student creation is allowed for users with `students:manage`, currently School
Admin and Teacher.

### Guardians

```http
POST /api/v1/guardians
GET  /api/v1/guardians
GET  /api/v1/guardians/:guardianId
PATCH /api/v1/guardians/:guardianId
POST /api/v1/guardians/:guardianId/students
```

Completed:

- School-scoped guardian CRUD.
- Search and pagination.
- Guardian-to-student linking.
- Same-school validation.

### Academic years

```http
POST /api/v1/academic-years
GET  /api/v1/academic-years
GET  /api/v1/academic-years/:academicYearId
PATCH /api/v1/academic-years/:academicYearId
POST /api/v1/academic-years/:academicYearId/activate
```

Completed:

- Date-range validation.
- One active academic year per school.
- Transaction-based activation.

### Classes

```http
POST  /api/v1/classes
GET   /api/v1/classes
GET   /api/v1/classes/:classId
PATCH /api/v1/classes/:classId
```

Completed:

- School and academic-year scoping.
- Duplicate class-name protection.
- Enrollment counts.

### Sections

```http
POST  /api/v1/sections
GET   /api/v1/sections
GET   /api/v1/sections/:sectionId
PATCH /api/v1/sections/:sectionId
```

Completed:

- School, class, and academic-year validation.
- Duplicate section-name protection within a class.
- Enrollment counts.

### Subjects

```http
POST  /api/v1/subjects
GET   /api/v1/subjects
GET   /api/v1/subjects/:subjectId
PATCH /api/v1/subjects/:subjectId
```

Completed:

- School and academic-year scoping.
- Subject code normalization to uppercase.
- Duplicate subject-code protection within a school and academic year.
- Read/manage permissions for School Admin.
- Read permission for Principal and Teacher.

### Staff assignments

```http
POST   /api/v1/staff-assignments
GET    /api/v1/staff-assignments
DELETE /api/v1/staff-assignments/:assignmentId
```

Completed:

- Links a teacher staff profile to a class, subject, and academic year.
- Validates that all referenced records belong to the authenticated school
  and academic year.
- Prevents duplicate teacher/class/subject/year assignments.
- Supports filtering by teacher, class, and academic year.
- Supports assignment removal.
- School Admin has read/manage permissions.
- Principal and Teacher have read permission.

### Student enrollment

Implementation is complete:

- School/year/class/section/student consistency validation.
- One enrollment per student per academic year.
- Roll-number support.
- Enrollment status updates.
- Filters by year, class, section, and student.
- School Admin read/manage permissions.
- Principal and Teacher read permission.

### Attendance

Implementation is complete:

- Attendance records tied to student enrollments.
- School scoping and enrollment validation.
- One record per enrollment per date.
- Present, absent, late, and excused statuses.
- Date and enrollment filters.
- Marked-by user tracking.
- School Admin and Teacher manage permissions.
- Principal read permission.

### Homework and diary

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

Completed as Sprint 6:

- School, academic-year, class, section, subject, and teacher scoping.
- Teacher-assignment validation before creating or changing homework.
- Draft, published, and archived homework status support.
- Student homework reads are restricted to the student's active enrollment.
- Student submissions support content or attachment URLs.
- Duplicate submissions are prevented per homework and student.
- School Admin and Principal have manage access.
- Teachers can manage their assigned homework.
- Students and Parents have read access.

### Announcements

```http
GET    /api/v1/announcements
POST   /api/v1/announcements
GET    /api/v1/announcements/:announcementId
PATCH  /api/v1/announcements/:announcementId
DELETE /api/v1/announcements/:announcementId
POST   /api/v1/announcements/:announcementId/publish
POST   /api/v1/announcements/:announcementId/archive
```

Completed as Sprint 6:

- School-scoped announcement CRUD.
- Draft, published, and archived status support.
- Publish and archive actions.
- Targeting by class, section, role, and metadata.
- Target class and section ownership validation.
- School Admin and Principal have manage access.
- Teachers, Students, and Parents have read access.

### Staff and teachers

```http
POST  /api/v1/staff
GET   /api/v1/staff
GET   /api/v1/staff/:staffId
PATCH /api/v1/staff/:staffId
```

Completed:

- Admin-only staff profile registration.
- Existing Supabase Auth user linking.
- Teacher role assignment.
- Employee number and NFC uniqueness.
- Teacher NFC replacement without changing login credentials.
- Cross-check preventing staff NFC from matching student NFC.

### Test accounts

Created and verified in a dedicated test school:

- School Admin test account.
- Teacher test account.
- Student test account.

Verified:

- Admin login.
- Teacher login.
- Student email login.
- Student generated-ID login.
- `/auth/me` for admin and student.
- Teacher access to the student list.
- ERP role links and school assignments.

The repeatable setup is
[bootstrap-test-accounts.ts](backend/scripts/bootstrap-test-accounts.ts).
Credentials are intentionally not documented here.

## Validation completed

- NestJS build passes.
- Prisma client generation passes.
- Prisma schema validation passes.
- Supabase migrations are applied and current.
- Seed script runs successfully.
- Health endpoint returns database `ok`.
- Unauthenticated protected routes return `401`.
- Anonymous Homework and Announcements requests return `401`.
- Real test-account authentication and role access were verified.
- Sprint 6 migration deployment reports no pending migrations.
- Sprint 6 Prisma validation and NestJS build pass.

## Known boundaries

- Physical NFC reader integration has not been tested.
- Web/mobile NFC capture UI is not implemented in this backend repository.
- NFC values are supplied by the client after reading a compatible NFC device.
- Row-Level Security policies are not enabled for direct Supabase Data API use.
- Full automated integration/E2E coverage is not yet implemented.
- Audit log writes for every sensitive mutation are not yet wired.

## Remaining roadmap

### Subsequent modules

1. Examinations, marks, and grades
2. Fees and payments
3. Timetable
4. Notifications
5. Reports
6. Admin user and role management UI/API
7. Frontend/mobile NFC capture
8. RLS hardening
9. Integration/E2E test suite
