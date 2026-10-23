# School ERP — Role Scenarios and Permissions

What each role can do in the backend as of 2026-10-23 (`/api/v1`), based on the
seeded permissions in `backend/prisma/seed.ts` and the service code. Every
scenario marked **Works** is exercised by the end-to-end suite
(`npm run test:e2e`, 277 checks passing).

- **Works** — implemented and covered by the e2e suite
- **Untested** — implemented but needs a real device, inbox, or account to verify
- **Partial** — works with a stated limit
- **Not built** — no implementation yet

---

## 1. How every request is checked

```mermaid
flowchart LR
  A[Client request] --> B{Route is Public?}
  B -- yes --> H[Handler runs]
  B -- no --> C{Bearer token valid<br/>in Supabase Auth?}
  C -- no --> X1[401]
  C -- yes --> R{Session revoked<br/>on the server?}
  R -- yes --> X1
  R -- no --> D{ERP user ACTIVE<br/>and school not archived?}
  D -- no --> X2[403]
  D -- yes --> F{Role permissions plus<br/>user overrides allow it?}
  F -- no --> X3[403]
  F -- yes --> G[Service applies record scope:<br/>self / children / assigned classes / school]
  G --> H
  H --> E["Response: { data, meta, error }"]
```

Access is decided at three levels: **permission**, **school**, and **record**.
Students see only themselves, parents only their linked children, teachers only
their assigned classes and sections, and School Admin, Principal, and Super Admin
the whole school.

## 2. How login works

```mermaid
flowchart TD
  A["POST /auth/login<br/>identifier + password"] --> L{5 failures in<br/>last 15 minutes?}
  L -- yes --> X0[429 locked for 15 minutes]
  L -- no --> B{Contains @ ?}
  B -- yes --> E1[Use as email]
  B -- no --> D{Student ID or<br/>staff profile ID?}
  D -- no --> X[401]
  D -- yes --> E2[Resolve the login email]
  E1 --> S[Supabase sign-in]
  E2 --> S
  S --> T[Tokens returned and<br/>session recorded]
  T --> M["GET /auth/sessions,<br/>POST /auth/logout,<br/>DELETE /auth/sessions/:id"]
```

| Scenario | Status |
|---|---|
| Login by email, student ID, or staff ID | Works |
| Lockout after repeated failures | Works |
| Logout and per-session revoke (token refused afterwards) | Works |
| Change password (current password required) | Works |
| Forgot / reset password, OTP sign-in, email verification | Untested (needs an inbox) |
| MFA setup / verify / disable | Untested (needs an authenticator app) |

## 3. Approval tiers

```mermaid
flowchart TD
  A[User makes a change] --> T{Sensitivity tier}
  T -- Tier 1 --> T1[Applied now, audited<br/>e.g. parent edits child phone]
  T -- Tier 2 --> T2[Applied with a reason, audited<br/>e.g. same-day attendance fix]
  T -- Tier 3 --> T3[Approval request] --> L3{School Admin or<br/>Principal approves?}
  T -- Tier 4 --> D4{Supporting document<br/>attached?}
  D4 -- no --> X[400]
  D4 -- yes --> T4[Approval request] --> A4[School Admin approves<br/>raising it counts] --> P4{Principal approves?}
  L3 -- yes --> AP[Change applied in the same transaction<br/>plus audit entry]
  P4 -- yes --> AP
  L3 -- no --> RJ[Rejected, requester notified]
  P4 -- no --> RJ
```

| Change | Tier |
|---|---|
| Parent contact details, own profile | 1 |
| Attendance edit within 48 hours (reason required) | 2 |
| Attendance older than 48 hours, section transfer, fee structure, discount, refund, bonafide/study certificate | 3 |
| Student name, date of birth, admission number; marks after release; re-opening released results; transfer certificate | 4 |

## 4. Permission matrix (seeded)

R = read, M = manage, * = limited to own / linked / assigned records.

| Area | Super Admin | School Admin | Principal | Teacher | Accountant | Parent | Student |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Organizations | R M | | | | | | |
| Schools and settings | R M | R M | R | | | | |
| Users, roles, overrides | R M | R M | R | | | | |
| Staff and assignments | | R M | R | R* | | | |
| Classes, sections, subjects, years | | R M | R | R | | | |
| Students | | R M | R | R M* | R | R* | R* |
| Guardians | | R M | R | R* | R | R* | R* |
| Enrollments | | R M | R | R* | | R* | R* |
| Attendance | | R M | R | R M* | | R* | R* |
| Homework | R M | R M | R M | R M* | | R* | R* + submit |
| Announcements | R M | R M | R M | R (audience) | R | R (audience) | R (audience) |
| Examinations and marks | | M, verify, release | M, verify, release | marks M* | | released R* | released R* |
| Fees and payments | | R M | R | | R M | R* + pay | R* + pay |
| Student leave | | decide | decide | decide (class teacher) | | request | request |
| Staff leave | | decide | decide | request | request | | |
| Timetable and substitutes | | R M | R M | R (own) | | R (published) | R (published) |
| Complaints | | manage | manage | | | submit / track | submit / track |
| Certificates | | R M | R | | | issued R* | issued R* |
| Approvals | R M | R M | R M | request | request | | |
| Audit and security logs | R | R | R | | | | |
| Reports and analytics | R | R | R | | fee reports | | |
| Transport | | R M | R | | | R* | R* |
| Library | | R M | R | R | | R* | R* |
| Assets | | R M | R | | | | |
| Offline sync | | manage | manage | write | | | |

Extra roles: **Librarian** (library manage), **Transport Staff** (transport manage),
**Reception** (guardians and certificates manage, approval requests). Every role can
read announcements, open its dashboard, upload files, send feedback, and manage its
own notifications.

---

## 5. Admin view

### 5.1 Super Admin — organization

| Scenario | Status |
|---|---|
| Create and edit own organization; schools in it; archive and restore schools | Works |
| Users, invitations, activation; roles and permission catalog | Works |
| Limited to own organization | Works |
| Archived school blocks its users | Works |

### 5.2 School Admin — set up and run the year

```mermaid
flowchart TD
  A["POST /academic-years then /activate"] --> B["POST /classes, /sections, /subjects"]
  B --> C["POST /staff with password<br/>creates login + Teacher role"]
  C --> D["POST /staff/:id/assignments<br/>class, optional section, subject, class teacher"]
  D --> E["POST /students<br/>login ID generated"]
  E --> F["POST /guardians, link child,<br/>POST /guardians/:id/account (parent login)"]
  F --> G["POST /enrollments<br/>or /enrollments/:id/promote"]
  G --> H["Fee structure -> approve -> assign"]
  H --> I["Timetable: generate-draft -> validate -> publish"]
  I --> J[Teachers mark attendance, set homework,<br/>enter marks]
  J --> K["Year end: /academic-years/:id/rollover,<br/>/close"]
```

| Scenario | Status |
|---|---|
| Academic year create, activate, summary, rollover (copy structure, optional promotion), close | Works |
| Classes, sections (archive when empty), subjects | Works |
| Staff with login in one call; activate/deactivate (signs them out) | Works |
| Section-level teacher assignments, class teacher flag, reassignment | Works |
| Students: register, archive/restore, history, documents | Works |
| Guardians with parent logins; link and unlink children | Works |
| Enrollment, promote, withdraw; transfer via Tier 3 | Works |
| Fee structures, assignment to a class, cash/cheque payments, receipts, discounts, refunds | Works |
| Examinations: verify, lock, release; reopen via Tier 4 | Works |
| Timetable generation with conflict checks; substitutes | Works |
| Complaints: assign, investigate, resolve; SLA auto-escalation | Works |
| Certificates: approve, generate, download | Works |
| Permission overrides per user | Works |
| Audit log search, CSV export, entity history; security events | Works |
| Dashboards, reports, analytics | Works |
| Transport, library, assets | Works |

Example: a teacher asks to move Ravi from 8-B to 8-A (Tier 3).

```mermaid
sequenceDiagram
  participant T as Teacher
  participant API as NestJS API
  participant SA as School Admin
  participant DB as PostgreSQL
  T->>API: POST /enrollments/:id/transfer (sectionId, reason)
  API->>DB: approval_requests (PENDING) + audit entry
  API-->>SA: notification "Approval needed"
  SA->>API: POST /approval-requests/:id/approve
  API->>DB: decision + enrollment moved + audit (one transaction)
  Note over T,DB: Ravi now appears in 8-A lists and attendance
```

### 5.3 Principal — oversight and approvals

| Scenario | Status |
|---|---|
| Read students, guardians, structure, attendance, staff | Works |
| Homework and announcements management | Works |
| Verify and release results | Works (as School Admin in tests) |
| Second approval on Tier 4 requests | Untested (no Principal test account yet) |
| Principal dashboard, reports, analytics, audit | Works |
| Decide staff leave; manage timetable and substitutes | Works |

### 5.4 Accountant

| Scenario | Status |
|---|---|
| Fee structures (submit for approval), assign, record and verify payments, receipts | Works (as School Admin in tests) |
| Request discounts and refunds (Tier 3) | Works |
| Overdue list, fee reports, accountant dashboard | Works |
| No access to marks, attendance, complaints | Works |

---

## 6. Teacher view

### 6.1 Daily attendance

```mermaid
flowchart TD
  A[Teacher logs in] --> B["GET /sections/:id/attendance<br/>only assigned sections"]
  B --> C["POST /attendance/bulk<br/>date + records"]
  C --> D{Date valid?}
  D -- future or outside year --> X[400]
  D -- ok --> E[Saved; parents of absent students notified]
  E --> F{Need to change a record?}
  F -- within 48 hours --> G["PATCH with reason (Tier 2)"]
  F -- older --> H["POST /:id/correction-request (Tier 3)"]
  H --> I[School Admin or Principal approves] --> J[Record updated + audit]
```

### 6.2 Homework

```mermaid
stateDiagram-v2
  [*] --> DRAFT: create (assigned class, section, subject only)
  DRAFT --> PUBLISHED: publish (families notified)
  PUBLISHED --> ARCHIVED: archive
  DRAFT --> [*]: delete (only without submissions)
  state PUBLISHED {
    [*] --> SUBMITTED: student submits (late flag if past due)
    SUBMITTED --> GRADED: teacher grades
    SUBMITTED --> RETURNED: teacher returns
    RETURNED --> SUBMITTED: student resubmits
  }
```

### 6.3 Marks

```mermaid
stateDiagram-v2
  [*] --> DRAFT: exam created, assessments added
  DRAFT --> VERIFIED: verify (all marks entered and submitted)
  VERIFIED --> DRAFT: reject
  VERIFIED --> LOCKED: lock
  LOCKED --> DRAFT: unlock
  LOCKED --> RELEASED: release (families notified)
  RELEASED --> DRAFT: re-release request (Tier 4 approved)
```

| Scenario | Status |
|---|---|
| Attendance only for assigned classes/sections; 48-hour rule; bulk; corrections | Works |
| Homework for assigned class + section + subject; grade and return | Works |
| Marks entry and bulk entry for own students; submit; Tier 3/4 corrections | Works |
| Register students; edit contact details of own students | Works |
| Name or date of birth change goes to Tier 4 approval | Works |
| Decide leave for own class (class teacher) | Works |
| Own timetable, substitute duties, pending work dashboard | Works |
| Request own leave; balance checked against entitlements | Works |
| Offline attendance and mark drafts via sync, with conflicts | Works |

---

## 7. Student view

```mermaid
flowchart TD
  A["POST /auth/login<br/>student ID + password"] --> B[Student home]
  B --> C["GET /students/{own}/homework"] --> D["POST /homework/:id/submit"]
  B --> E["GET /students/{own}/attendance"]
  B --> F["GET /students/{own}/report-cards<br/>released results only"]
  B --> G["GET /students/{own}/fee-summary"] --> H["POST /payments/orders"]
  B --> I["GET /sections/:id/timetable"]
  B --> J["GET /announcements<br/>school, class, section, or Student role"]
  B --> K["POST /student-leaves, /complaints, /feedback"]
```

| Scenario | Status |
|---|---|
| See only own record, attendance, homework, marks, fees | Works |
| Submit homework; graded work cannot be overwritten | Works |
| Report card with grades after release | Works |
| Pay online (order + verified webhook) | Works (dev order ids; real Razorpay needs keys) |
| Request leave; file anonymous or named complaints | Works |
| Library history, transport details, issued certificates | Works |

## 8. Parent view

```mermaid
flowchart TD
  A[School Admin creates guardian<br/>and parent login] --> B[Parent logs in]
  B --> C["GET /me/children"]
  C --> D["GET /dashboards/parent<br/>attendance, homework due, fees, results"]
  D --> E[Homework, attendance, report cards,<br/>fees, transport for linked children]
  B --> F["PATCH /me/children/:id/contact-details (Tier 1)"]
  B --> G["POST /student-leaves"] --> H[Class teacher approves] --> I[Attendance marked ON_LEAVE]
  B --> J["POST /complaints"] --> K[Admin/Principal only] --> L[Status updates and resolution]
```

| Scenario | Status |
|---|---|
| Parent login linked to children | Works |
| Sees only linked children and their guardians | Works |
| Notifications: absence, homework, results, payments, boarding | Works (in-app); push/SMS queued, no sender yet |
| Complaints never shown to the named teacher; submitter hidden from staff | Works |

---

## 9. Leave and substitutes

```mermaid
flowchart LR
  A[Teacher requests leave] --> B{Balance left?}
  B -- no --> X[400]
  B -- yes --> C[Principal / Admin approves]
  C --> D[Substitute request per timetabled period]
  D --> E["GET available-teachers<br/>free, not on leave, under daily limit,<br/>subject specialists first"]
  E --> F[Assign or auto-assign] --> G[Substitute notified]
```

## 10. Remaining gaps

| Gap | Effect |
|---|---|
| No Principal test account | Tier 4 second approval not covered by tests |
| No notification sender | Push, SMS, email rows stay QUEUED |
| No Row-Level Security | Direct Supabase Data API access is not restricted (the app does not use it) |
| Reports run synchronously | Very large exports may be slow |
| Frontend and mobile apps | Not started |
