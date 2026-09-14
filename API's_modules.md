# School ERP API Modules and Development Flow

This document defines the module-wise backend API catalog and recommended
development sequence for the school ERP described in
[school-erp-architecture.md](./school-erp-architecture.md) and
[recommended-techstack.md](./recommended-techstack.md).

## 1. Overall System Flow

```text
Student / Parent / Teacher / Accountant / Principal / Admin
                         |
                         v
              Web Application / Mobile App
              Next.js / React Native + Expo
                         |
                         v
             Cloudflare DNS / WAF / Rate Limits
                         |
                         v
                  NestJS REST API
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
  Authorization       AuditService      Validation
  RBAC + school       Append-only       DTO + schema
  and record scope    audit records
        |                |                |
        +----------------+----------------+
                         |
          +--------------+---------------+
          |              |              |
          v              v              v
     PostgreSQL        Redis       Object Storage
     Main database     Cache/jobs  Supabase/R2/Blob
```

The backend is authoritative. Frontend permission checks are only for user
experience; every request must be authorized again by NestJS.

## 2. Development Flow

```text
Database schema and migrations
              |
              v
Authentication and sessions
              |
              v
RBAC, school scope, and permissions
              |
              v
Audit logging and approval engine
              |
              v
School and academic structure
              |
              v
Students, guardians, and enrollments
              |
              v
Attendance
              |
              v
Homework and announcements
              |
              v
Examinations and marks
              |
              v
Fees and receipts
              |
              v
Dashboards and reports
              |
              v
Leave, timetable, substitutes, complaints
              |
              v
Transport, library, inventory, analytics
              |
              v
Offline synchronization and advanced features
```

## 3. Database Foundation

Create and migrate these foundational tables first:

```text
organizations
schools
academic_years
school_settings
users
roles
permissions
role_permissions
user_roles
permission_overrides
user_sessions
login_attempts
students
guardians
student_guardians
staff_profiles
classes
sections
subjects
teacher_assignments
student_enrollments
audit_logs
approval_requests
file_assets
notifications
notification_preferences
```

Required database rules:

- Use UUID primary keys.
- Add foreign keys and unique constraints.
- Include `created_at` and `updated_at`.
- Scope operational records to `school_id`.
- Associate academic records with `academic_year_id`.
- Preserve history using `student_enrollments`.
- Use migrations stored in source control.
- Use separate development, staging, and production databases.
- Do not hard-delete Tier 3 or Tier 4 records.

## 4. Common API Rules

Base path:

```text
/api/v1
```

Example response:

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

Every protected request must verify:

1. Authentication
2. Organization scope
3. School scope
4. Academic-year scope where applicable
5. Role permission
6. Record ownership or assignment
7. Sensitivity-tier rules
8. Approval requirements

Use:

```text
GET     Read
POST    Create or perform an explicit domain action
PATCH   Partial update
DELETE  Delete/archive only where permitted
```

Prefer resource-based URLs:

```http
GET /api/v1/students/:studentId/attendance
```

Use explicit actions for state transitions:

```http
POST /api/v1/marks/:markId/submit
POST /api/v1/marks/:markId/release
POST /api/v1/approval-requests/:id/approve
```

## 5. Module 1 - Authentication and Sessions

### Public APIs

```http
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
POST   /api/v1/auth/send-otp
POST   /api/v1/auth/verify-otp
POST   /api/v1/auth/verify-email
```

### Authenticated APIs

```http
GET    /api/v1/auth/me
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
DELETE /api/v1/auth/sessions/all
POST   /api/v1/auth/change-password
POST   /api/v1/auth/mfa/setup
POST   /api/v1/auth/mfa/verify
POST   /api/v1/auth/mfa/disable
```

Security requirements:

- Five failed account attempts within 15 minutes, followed by temporary
  protection.
- IP and device rate limits stored in Redis.
- Generic login errors to prevent account enumeration.
- Refresh-token rotation and session revocation.
- MFA for School Admin and Principal accounts.
- Audit events for login, logout, password, MFA, and session activity.

## 6. Module 2 - Organizations and Schools

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

## 7. Module 3 - Academic Years

```http
GET    /api/v1/academic-years
POST   /api/v1/academic-years
GET    /api/v1/academic-years/:academicYearId
PATCH  /api/v1/academic-years/:academicYearId
POST   /api/v1/academic-years/:academicYearId/activate
POST   /api/v1/academic-years/:academicYearId/close
POST   /api/v1/academic-years/:academicYearId/rollover
GET    /api/v1/academic-years/:academicYearId/summary
```

Rollover must preserve history while supporting promotion, retention,
sections, subjects, and teacher assignments.

## 8. Module 4 - Users, Roles, and Permissions

### Users

```http
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:userId
PATCH  /api/v1/users/:userId
POST   /api/v1/users/:userId/activate
POST   /api/v1/users/:userId/deactivate
POST   /api/v1/users/:userId/invite
POST   /api/v1/users/:userId/resend-invite
```

### Roles and permissions

```http
GET    /api/v1/roles
POST   /api/v1/roles
GET    /api/v1/roles/:roleId
PATCH  /api/v1/roles/:roleId
GET    /api/v1/permissions
GET    /api/v1/roles/:roleId/permissions
PUT    /api/v1/roles/:roleId/permissions
```

### User role assignments

```http
GET    /api/v1/users/:userId/roles
POST   /api/v1/users/:userId/roles
DELETE /api/v1/users/:userId/roles/:roleId
GET    /api/v1/users/:userId/permission-overrides
POST   /api/v1/users/:userId/permission-overrides
DELETE /api/v1/users/:userId/permission-overrides/:overrideId
```

Role and permission changes must always be audited.

## 9. Module 5 - Staff, Teachers, and Assignments

```http
GET    /api/v1/staff
POST   /api/v1/staff
GET    /api/v1/staff/:staffId
PATCH  /api/v1/staff/:staffId
POST   /api/v1/staff/:staffId/activate
POST   /api/v1/staff/:staffId/deactivate
GET    /api/v1/staff/:staffId/assignments
POST   /api/v1/staff/:staffId/assignments
PATCH  /api/v1/staff/:staffId/assignments/:assignmentId
DELETE /api/v1/staff/:staffId/assignments/:assignmentId
```

Assignments include teacher, subject, class, section, academic year, and
effective date. Teacher reassignment is an approval-controlled operation.

## 10. Module 6 - Classes, Sections, and Subjects

```http
GET    /api/v1/classes
POST   /api/v1/classes
GET    /api/v1/classes/:classId
PATCH  /api/v1/classes/:classId

GET    /api/v1/sections
POST   /api/v1/sections
GET    /api/v1/sections/:sectionId
PATCH  /api/v1/sections/:sectionId
POST   /api/v1/sections/:sectionId/archive

GET    /api/v1/subjects
POST   /api/v1/subjects
GET    /api/v1/subjects/:subjectId
PATCH  /api/v1/subjects/:subjectId
```

## 11. Module 7 - Students and Enrollments

### Students

```http
GET    /api/v1/students
POST   /api/v1/students
GET    /api/v1/students/:studentId
PATCH  /api/v1/students/:studentId
POST   /api/v1/students/:studentId/archive
POST   /api/v1/students/:studentId/restore
GET    /api/v1/students/:studentId/history
GET    /api/v1/students/:studentId/documents
```

### Enrollments

```http
GET    /api/v1/students/:studentId/enrollments
POST   /api/v1/students/:studentId/enrollments
GET    /api/v1/enrollments
PATCH  /api/v1/enrollments/:enrollmentId
POST   /api/v1/enrollments/:enrollmentId/transfer
POST   /api/v1/enrollments/:enrollmentId/promote
POST   /api/v1/enrollments/:enrollmentId/withdraw
```

Student name, date of birth, ID, and enrollment transfer changes require the
appropriate Tier 3 or Tier 4 approval.

## 12. Module 8 - Parents and Guardians

```http
GET    /api/v1/guardians
POST   /api/v1/guardians
GET    /api/v1/guardians/:guardianId
PATCH  /api/v1/guardians/:guardianId
GET    /api/v1/guardians/:guardianId/children
POST   /api/v1/guardians/:guardianId/children
DELETE /api/v1/guardians/:guardianId/children/:studentId

GET    /api/v1/me/children
GET    /api/v1/me/children/:studentId
PATCH  /api/v1/me/profile
PATCH  /api/v1/me/children/:studentId/contact-details
```

Parents may edit only permitted Tier 1 fields.

## 13. Module 9 - Attendance

```http
GET    /api/v1/attendance
POST   /api/v1/attendance
POST   /api/v1/attendance/bulk
GET    /api/v1/attendance/:attendanceId
PATCH  /api/v1/attendance/:attendanceId
POST   /api/v1/attendance/:attendanceId/correction-request
GET    /api/v1/attendance/summary
GET    /api/v1/students/:studentId/attendance
GET    /api/v1/sections/:sectionId/attendance
GET    /api/v1/attendance/export
```

Statuses:

```text
Present | Absent | Late | On Leave | Excused
```

Teachers may mark only assigned classes and periods. Older corrections require
approval. Offline attendance is pending until server synchronization.

## 14. Module 10 - Leave Management

### Student leave

```http
GET    /api/v1/student-leaves
POST   /api/v1/student-leaves
GET    /api/v1/student-leaves/:leaveId
PATCH  /api/v1/student-leaves/:leaveId
POST   /api/v1/student-leaves/:leaveId/approve
POST   /api/v1/student-leaves/:leaveId/reject
POST   /api/v1/student-leaves/:leaveId/cancel
```

### Staff leave

```http
GET    /api/v1/staff-leaves
POST   /api/v1/staff-leaves
GET    /api/v1/staff-leaves/:leaveId
POST   /api/v1/staff-leaves/:leaveId/approve
POST   /api/v1/staff-leaves/:leaveId/reject
POST   /api/v1/staff-leaves/:leaveId/cancel
GET    /api/v1/staff/:staffId/leave-balance
PATCH  /api/v1/staff/:staffId/leave-entitlements
```

Approved teacher leave should trigger substitute processing.

## 15. Module 11 - Homework and Diary

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

## 16. Module 12 - Announcements

```http
GET    /api/v1/announcements
POST   /api/v1/announcements
GET    /api/v1/announcements/:announcementId
PATCH  /api/v1/announcements/:announcementId
DELETE /api/v1/announcements/:announcementId
POST   /api/v1/announcements/:announcementId/publish
POST   /api/v1/announcements/:announcementId/archive
```

Announcements can target the entire school, classes, sections, teachers,
parents, students, or specific roles.

## 17. Module 13 - Examinations and Marks

### Examinations

```http
GET    /api/v1/examinations
POST   /api/v1/examinations
GET    /api/v1/examinations/:examinationId
PATCH  /api/v1/examinations/:examinationId
POST   /api/v1/examinations/:examinationId/lock
POST   /api/v1/examinations/:examinationId/unlock
```

### Marks

```http
GET    /api/v1/marks
POST   /api/v1/marks
POST   /api/v1/marks/bulk
GET    /api/v1/marks/:markId
PATCH  /api/v1/marks/:markId
POST   /api/v1/marks/submit
POST   /api/v1/marks/:markId/correction-request
```

### Verification and release

```http
GET    /api/v1/examinations/:examinationId/verification
POST   /api/v1/examinations/:examinationId/verify
POST   /api/v1/examinations/:examinationId/reject
POST   /api/v1/examinations/:examinationId/release
POST   /api/v1/examinations/:examinationId/rerelease-request
GET    /api/v1/students/:studentId/report-cards
```

MVP state:

```text
Draft -> Submitted -> Published
```

Later state:

```text
Draft -> Submitted -> Verified -> Locked -> Released
```

Post-release changes are Tier 4.

## 18. Module 14 - Fees and Finance

### Fee structures

```http
GET    /api/v1/fee-structures
POST   /api/v1/fee-structures
GET    /api/v1/fee-structures/:feeStructureId
PATCH  /api/v1/fee-structures/:feeStructureId
POST   /api/v1/fee-structures/:feeStructureId/submit-approval
POST   /api/v1/fee-structures/:feeStructureId/approve
POST   /api/v1/fee-structures/:feeStructureId/reject
```

### Student fees and payments

```http
GET    /api/v1/student-fees
POST   /api/v1/student-fees
GET    /api/v1/student-fees/:studentFeeId
PATCH  /api/v1/student-fees/:studentFeeId
POST   /api/v1/student-fees/:studentFeeId/apply-discount

GET    /api/v1/payments
POST   /api/v1/payments
GET    /api/v1/payments/:paymentId
POST   /api/v1/payments/:paymentId/verify
POST   /api/v1/payments/:paymentId/refund-request
POST   /api/v1/payments/:paymentId/refund
GET    /api/v1/payments/:paymentId/receipt
GET    /api/v1/students/:studentId/fee-summary
GET    /api/v1/fees/overdue
GET    /api/v1/fees/reports
```

### Payment gateways

```http
POST   /api/v1/payments/orders
POST   /api/v1/payments/webhooks/razorpay
POST   /api/v1/payments/webhooks/cashfree
```

Webhooks must be signature-verified and idempotent. Never store raw card,
bank, CVV, or UPI credentials.

## 19. Module 15 - Feedback and Complaints

### Feedback

```http
GET    /api/v1/feedback
POST   /api/v1/feedback
GET    /api/v1/feedback/:feedbackId
PATCH  /api/v1/feedback/:feedbackId
```

### Complaints

```http
GET    /api/v1/complaints
POST   /api/v1/complaints
GET    /api/v1/complaints/:complaintId
PATCH  /api/v1/complaints/:complaintId
POST   /api/v1/complaints/:complaintId/assign
POST   /api/v1/complaints/:complaintId/start-investigation
POST   /api/v1/complaints/:complaintId/add-action
POST   /api/v1/complaints/:complaintId/resolve
POST   /api/v1/complaints/:complaintId/reopen
POST   /api/v1/complaints/:complaintId/escalate
GET    /api/v1/complaints/:complaintId/history
```

Complaint permissions are separate from normal student permissions. Evidence
files must be private and accessed with short-lived signed URLs.

## 20. Module 16 - Timetable and Resources

```http
GET    /api/v1/timetables
POST   /api/v1/timetables
GET    /api/v1/timetables/:timetableId
PATCH  /api/v1/timetables/:timetableId
POST   /api/v1/timetables/generate-draft
POST   /api/v1/timetables/:timetableId/validate
POST   /api/v1/timetables/:timetableId/publish
POST   /api/v1/timetables/:timetableId/lock

GET    /api/v1/timetable-slots
POST   /api/v1/timetable-slots
PATCH  /api/v1/timetable-slots/:slotId
DELETE /api/v1/timetable-slots/:slotId
GET    /api/v1/teachers/:teacherId/timetable
GET    /api/v1/sections/:sectionId/timetable
```

Reject teacher conflicts, room conflicts, lab conflicts, workload violations,
and invalid subject-resource combinations.

## 21. Module 17 - Substitute Teachers

```http
GET    /api/v1/substitute-requests
POST   /api/v1/substitute-requests
GET    /api/v1/substitute-requests/:requestId
GET    /api/v1/substitute-requests/:requestId/available-teachers
POST   /api/v1/substitute-requests/:requestId/assign
POST   /api/v1/substitute-requests/:requestId/auto-assign
POST   /api/v1/substitute-requests/:requestId/cancel
```

Reuse the timetable conflict engine for substitute assignment.

## 22. Module 18 - Notifications

```http
GET    /api/v1/notifications
GET    /api/v1/notifications/unread-count
POST   /api/v1/notifications/:notificationId/read
POST   /api/v1/notifications/read-all
GET    /api/v1/notification-preferences
PATCH  /api/v1/notification-preferences
POST   /api/v1/devices
DELETE /api/v1/devices/:deviceId
```

Administrative APIs:

```http
GET    /api/v1/notification-templates
POST   /api/v1/notification-templates
PATCH  /api/v1/notification-templates/:templateId
GET    /api/v1/notification-deliveries
POST   /api/v1/notifications/test
```

Use background workers for push, SMS, email, and WhatsApp delivery.

## 23. Module 19 - Documents and Certificates

### File assets

```http
POST   /api/v1/files/upload
GET    /api/v1/files/:fileId
DELETE /api/v1/files/:fileId
GET    /api/v1/files/:fileId/download-url
```

### Certificates

```http
GET    /api/v1/certificates
POST   /api/v1/certificates
GET    /api/v1/certificates/:certificateId
POST   /api/v1/certificates/:certificateId/submit-approval
POST   /api/v1/certificates/:certificateId/approve
POST   /api/v1/certificates/:certificateId/reject
POST   /api/v1/certificates/:certificateId/generate
GET    /api/v1/certificates/:certificateId/download
```

Transfer certificates are Tier 4 and immutable after issuance.

## 24. Module 20 - Approval Workflows

```http
GET    /api/v1/approval-requests
POST   /api/v1/approval-requests
GET    /api/v1/approval-requests/:approvalRequestId
POST   /api/v1/approval-requests/:approvalRequestId/approve
POST   /api/v1/approval-requests/:approvalRequestId/reject
POST   /api/v1/approval-requests/:approvalRequestId/cancel
GET    /api/v1/approval-requests/:approvalRequestId/history
```

Use the common approval service for:

- Late attendance corrections
- Student class changes
- Name or date-of-birth changes
- Fee structure changes
- Discounts
- Marks re-release
- Transfer certificates
- Salary changes
- Permission changes

## 25. Module 21 - Audit and Security Logs

### Audit APIs

```http
GET    /api/v1/audit-logs
GET    /api/v1/audit-logs/:auditLogId
GET    /api/v1/audit-logs/entity/:entityType/:entityId
GET    /api/v1/audit-logs/export
```

### Security event APIs

```http
GET    /api/v1/security-events
GET    /api/v1/security-events/login-attempts
GET    /api/v1/security-events/suspicious-activity
POST   /api/v1/security-events/:eventId/acknowledge
```

Audit records are append-only. Do not expose normal update or delete APIs for
audit records.

Every important business action should record:

```text
actor_user_id
actor_role
organization_id
school_id
action
entity_type
entity_id
field_name
old_value
new_value
reason
approval_request_id
ip_address
device_id
user_agent
request_id
created_at
metadata
```

## 26. Module 22 - Dashboards and Reports

### Dashboards

```http
GET    /api/v1/dashboards/principal
GET    /api/v1/dashboards/teacher
GET    /api/v1/dashboards/parent
GET    /api/v1/dashboards/accountant
GET    /api/v1/teachers/:teacherId/today
GET    /api/v1/teachers/:teacherId/pending-work
GET    /api/v1/parents/:parentId/children-summary
```

### Reports

```http
GET    /api/v1/reports/attendance-summary
GET    /api/v1/reports/fee-summary
GET    /api/v1/reports/examination-status
GET    /api/v1/reports/pending-approvals
GET    /api/v1/reports/complaint-summary
GET    /api/v1/reports/collections
GET    /api/v1/reports/overdue-fees
GET    /api/v1/reports/reconciliation
```

Large reports should run asynchronously through BullMQ.

## 27. Module 23 - Transport (Phase 3)

```http
GET    /api/v1/transport/routes
POST   /api/v1/transport/routes
GET    /api/v1/transport/routes/:routeId
PATCH  /api/v1/transport/routes/:routeId
GET    /api/v1/transport/stops
POST   /api/v1/transport/stops
PATCH  /api/v1/transport/stops/:stopId
GET    /api/v1/transport/buses
POST   /api/v1/transport/buses
PATCH  /api/v1/transport/buses/:busId
GET    /api/v1/transport/drivers
POST   /api/v1/transport/drivers
PATCH  /api/v1/transport/drivers/:driverId
POST   /api/v1/transport/allocations
PATCH  /api/v1/transport/allocations/:allocationId
GET    /api/v1/students/:studentId/transport
POST   /api/v1/transport/boarding-events
GET    /api/v1/transport/boarding-events
```

Add GPS only after route and boarding workflows are stable.

## 28. Module 24 - Library (Phase 3)

```http
GET    /api/v1/library/books
POST   /api/v1/library/books
GET    /api/v1/library/books/:bookId
PATCH  /api/v1/library/books/:bookId
GET    /api/v1/library/categories
POST   /api/v1/library/categories
POST   /api/v1/library/issues
POST   /api/v1/library/returns
GET    /api/v1/library/transactions
GET    /api/v1/students/:studentId/library-history
POST   /api/v1/library/fines
POST   /api/v1/library/fines/:fineId/waive
```

## 29. Module 25 - Inventory and Assets (Phase 3)

```http
GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/:assetId
PATCH  /api/v1/assets/:assetId
POST   /api/v1/assets/:assetId/assign
POST   /api/v1/assets/:assetId/transfer
POST   /api/v1/assets/:assetId/maintenance
POST   /api/v1/assets/:assetId/dispose
GET    /api/v1/assets/:assetId/history
```

## 30. Module 26 - Analytics (Phase 3 and Phase 4)

```http
GET    /api/v1/analytics/attendance
GET    /api/v1/analytics/academic-performance
GET    /api/v1/analytics/fee-collection
GET    /api/v1/analytics/teacher-workload
GET    /api/v1/analytics/complaints
GET    /api/v1/analytics/attendance-risk
```

Predictive analytics should not be included in the initial MVP.

## 31. Module 27 - Offline Synchronization

Implement only after the online workflows are stable.

```http
POST   /api/v1/sync/batches
GET    /api/v1/sync/batches/:batchId
POST   /api/v1/sync/attendance
POST   /api/v1/sync/mark-drafts
GET    /api/v1/sync/conflicts
POST   /api/v1/sync/conflicts/:conflictId/resolve
GET    /api/v1/sync/checkpoint
```

Offline data is a pending server operation, not an authoritative record.
The server validates permissions, detects conflicts, and creates the final
audit entry.

## 32. MVP API Build Order

### Sprint 1 - Database and platform

```text
Organizations
Schools
Academic years
Users
Roles
Permissions
Audit logs
Approval requests
Sessions
```

### Sprint 2 - Authentication

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

### Sprint 3 - School structure

```text
Schools
Academic years
Classes
Sections
Subjects
Staff
Teacher assignments
```

### Sprint 4 - Students and parents

```text
Students
Guardians
Student-guardian links
Student enrollments
Student history
```

### Sprint 5 - Attendance

```http
POST  /api/v1/attendance
POST  /api/v1/attendance/bulk
GET   /api/v1/attendance
PATCH /api/v1/attendance/:attendanceId
POST  /api/v1/attendance/:attendanceId/correction-request
GET   /api/v1/students/:studentId/attendance
```

### Sprint 6 - Homework and announcements

```text
Homework
Homework publishing
Announcements
Announcement publishing
Parent/student read APIs
```

### Sprint 7 - Basic marks

```text
Examinations
Assessments
Marks entry
Marks submission
Marks publishing
Student report view
```

### Sprint 8 - Basic fees

```text
Fee structures
Student fee assignments
Payments
Receipts
Fee summaries
Overdue reports
```

### Sprint 9 - Administration and security

```text
Audit log search
Security events
Approval workflows
Permission management
Admin dashboards
```

Only after these APIs are stable should the first complete web and mobile
workflows be implemented.

## 33. Recommended NestJS Structure

```text
src/
  modules/
    auth/
    organizations/
    schools/
    academic-years/
    users/
    roles/
    permissions/
    staff/
    classes/
    sections/
    subjects/
    students/
    guardians/
    enrollments/
    attendance/
    homework/
    announcements/
    examinations/
    marks/
    fees/
    notifications/
    files/
    approvals/
    audit/
    dashboards/
  common/
    guards/
    interceptors/
    decorators/
    pipes/
    filters/
    database/
    redis/
  workers/
    notifications/
    reports/
    payments/
```

Each module should contain its controller, service, repository or Prisma
access, DTOs, permission rules, and tests.

## 34. Required Shared Backend Services

Build these reusable services instead of duplicating logic:

```text
AuthService
PermissionService
SchoolScopeService
AuditService
ApprovalService
FileStorageService
NotificationService
RateLimitService
IdempotencyService
ReportJobService
ConflictResolutionService
```

## 35. Final Implementation Rule

The correct order is:

```text
Database
  -> Authentication
  -> Authorization
  -> Audit and approvals
  -> Core school data
  -> MVP business APIs
  -> Web and mobile clients
  -> Advanced modules
```

Do not begin by building isolated frontend screens. Build and test the
database, API contracts, authorization, audit logging, and core workflows
first. Both the Next.js web application and React Native mobile application
should consume the same versioned NestJS API.
