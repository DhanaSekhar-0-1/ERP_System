# Student ERP System for Indian Schools — Architecture & Planning Document

*Prepared as a consolidated redesign of the original requirements, covering RBAC, controlled-change workflows, modules, security, architecture, and roadmap.*

---

## 1. Objective and Design Principles

The goal is a centralized ERP (web + mobile) that digitizes school operations while remaining affordable and maintainable for Indian schools of varying sizes. Five principles drive every decision below:

1. **Permission before convenience** — anyone can *see* a lot; very few can *change* sensitive data, and every change is traceable.
2. **Configurable, not hardcoded, roles** — schools vary; a fixed permission set will not survive contact with a real school office.
3. **Modular core** — a small, reliable V1 beats a large, fragile one. New modules must plug in without touching existing data models.
4. **Low-bandwidth-first** — assume patchy internet, shared devices, and non-technical staff.
5. **One source of truth per fact** — e.g., a student's current class lives in one table, not duplicated across modules.

---

## 2. Roles and RBAC Architecture

### 2.1 Roles

| Role | Scope |
|---|---|
| Super Admin | Cross-school/organization config (for a group running multiple schools); billing, module enablement |
| School Admin | Full operational control within one school |
| Principal | Academic/administrative oversight, approvals, overrides, alerts |
| Vice Principal / Headmaster | Delegated subset of Principal powers (configurable) |
| Class Teacher | Everything a Subject Teacher has, plus full view and limited edit rights over their assigned class (diary, leave approval for that class, homeroom attendance) |
| Subject Teacher | Access limited to the subjects/classes/sections assigned to them |
| Accountant / Fee Staff | Fee module only; no access to marks, diary, or complaints |
| Reception / Office Staff | Admissions intake, certificates, front-office communication |
| Librarian | Library module only |
| Transport Staff | Routes, buses, student-route allocation, transport attendance |
| Parent | Their linked child/children only |
| Student | Their own record only, read-mostly, via parent account, web portal, or (optionally) their own limited login |

### 2.2 Fixed vs. Configurable Permissions

Two layers:

- **Role templates (fixed defaults)** — Super Admin defines what "Teacher," "Accountant," etc. can do out of the box. This is what 90% of schools use unchanged.
- **Permission overrides (School Admin configurable)** — School Admin can grant/revoke specific permissions per user or per role *within their school* (e.g., "allow this teacher to also view attendance analytics for Class 9"). Overrides are themselves logged.

This two-layer model avoids two failure modes: a rigid system that can't match how a specific school actually works, and a fully open system where permissions drift into chaos with no baseline.

### 2.3 Permission Actions

Every module permission is expressed as a combination of: `View / Create / Edit / Delete / Approve / Reject / Publish / Export / Override / Lock-Unlock / Assign-Reassign`, scoped to `Own / Assigned / Class / School / Organization`. E.g., a Subject Teacher's "Edit Marks" permission is scoped to `Assigned Subject + Assigned Class`, not `School`.

---

## 3. Controlled Change Workflow (Data Sensitivity Tiers)

Not all data deserves the same friction. Four tiers:

**Tier 1 — Low sensitivity, immediate self-service edit, logged.**
Examples: parent's own phone/email/address, communication preferences, teacher's own diary draft before submission.
`User edits → saved → audit log entry (who/when/old/new)`

**Tier 2 — Moderate sensitivity, edit + reason, logged, reversible window.**
Examples: attendance correction by a teacher on the same day, homework/diary corrections, non-final exam marks before submission.
`Teacher edits → must enter reason → saved → audit log → visible to Admin/Principal`

**Tier 3 — High sensitivity, requires approval before it takes effect.**
Examples: attendance correction after 24–48 hours, released exam marks, student class/section change, fee structure changes, teacher-to-class reassignment.
`Requester submits change + reason (+ document if applicable) → Admin/Principal review → Approve → Change applied → Audit log` (or Reject → requester notified with reason)

**Tier 4 — Critical/irreversible, dual control, Admin+Principal, document required.**
Examples: Student ID changes, date of birth correction, student name correction, transfer certificate issuance, official exam result re-issuance, teacher salary structure changes, school-wide configuration (grading scale, academic year rollover).
`Admin raises change request + supporting document → Principal approval → Change applied → Immutable audit entry (previous value permanently retained)`

| Data / Operation | Tier | Approval | Document Required |
|---|---|---|---|
| Parent contact info | 1 | No | No |
| Attendance (same day, own class) | 2 | No (logged) | No |
| Attendance (>48h old) | 3 | Admin | Optional |
| Marks entry (pre-submission) | 2 | No | No |
| Marks (post-release) | 4 | Admin + Principal | Yes |
| Student DOB / Name | 4 | Admin + Principal | Yes (ID proof) |
| Student class/section | 3 | Admin | No |
| Transfer Certificate | 4 | Admin + Principal | Yes |
| Fee structure | 3 | Admin | No |
| Teacher salary | 4 | Admin (Principal notified) | Yes |
| School calendar/holiday | 3 | Admin | No |

All tiers write to a single append-only **audit log** (Section 17); nothing is ever hard-deleted from Tier 3/4 records — only superseded, with history retained.

---

## 4. Permission Matrix (Representative)

| Module | Super Admin | School Admin | Principal | Class Teacher | Subject Teacher | Accountant | Parent | Student |
|---|---|---|---|---|---|---|---|---|
| Student Profile | Full | Full | View / Request Edit | View (class) | View (assigned) | View (fee-relevant fields only) | Own child, edit Tier 1 fields | Own, view-only |
| Attendance | — | Full/Override | View / Override | Mark (own class) + Tier-2 edit | Mark (own periods) | — | View (own child) | View (own) |
| Marks | — | Full/Verify/Release | Approve / Override / Release | View (class) | Enter (assigned subject) | — | View (own child, post-release) | View (own, post-release) |
| Homework/Diary | — | View | View | Create/Edit (class) | Create/Edit (assigned subject) | — | View | View |
| Fees | — | Full | View + reports | — | — | Full (collect, receipt, reminders) | View/Pay (own child) | View (limited) |
| Teacher Management | Full | Full | View / Recommend | — | — | — | — | — |
| Transport | — | Full | View | — | — | — | View (own child's route) | View (own) |
| Complaints | — | Full (per privacy rules) | Full | View (only if about self, once resolved-summary) | — | — | Submit/Track own | — |
| Reports/Analytics | Full (org-wide) | Full (school) | Full (school) | Class-level | Assigned-subject-level | Fee reports only | Own child only | Own only |
| Settings/Config | Full | School-level | Limited (approval settings) | — | — | — | — | — |

This is intentionally different from a naive "Admin=Full, everyone else=Less" table: note Accountant has *zero* access to marks/attendance, and Class Teacher has broader visibility than a Subject Teacher without inheriting Admin powers — this mirrors how Indian schools actually separate financial, academic, and administrative staff.

---

## 5. Core Modules — V1 vs. Later

**Phase 1 (MVP — must work for a school to go live digitally):**
Student registration & ID, class/section management, parent accounts & linking, attendance (manual + optional NFC), basic marks entry (no complex workflow yet — Tier 2 only), homework/diary, announcements, basic fee tracking (view/record, not full payment gateway), core RBAC + audit log.

**Phase 2 (makes it a real school system):**
Full examination workflow (create → verify → lock → release), report cards, timetable module with conflict detection, leave management (student + teacher), substitute teacher assignment, parent complaints/feedback, online fee payment integration, push/SMS notifications, teacher attendance & salary.

**Phase 3 (breadth):**
Transport with NFC boarding/drop-off and optional GPS, library, sports/events/certificates, inventory/assets, analytics dashboards (class/school-level), lesson planning & syllabus tracking, OCR-assisted mark entry.

**Phase 4 (scale & polish):**
Multi-school/organization support (Super Admin layer), advanced analytics/predictive attendance-risk flags, WhatsApp Business API integration, offline-first mobile sync, biometric attendance options, parent app personalization.

Rationale: Phase 1 is deliberately narrow — a school can *run* on it. Every later phase adds a module without altering the Phase 1 data model (student, class, section, and user tables are designed to be stable foundations from day one; see Section 20).

---

## 6. Parent Feedback & Complaint System

- **Feedback** (general, non-adversarial) is visible to Admin/Principal by default; can be tagged to a teacher/service. Not anonymous — the school can always identify the submitter (for follow-up), but a "confidential" flag hides the submitter's identity from anyone except Admin/Principal.
- **Complaints** follow a stricter path: `Parent → Submit (category + optional evidence) → Routed to Admin/Principal (never directly to the teacher named) → Investigation → Action → Status update → Parent notified`.
- **Can a teacher see a complaint about themselves?** Only a redacted summary *after* the investigation concludes and Admin/Principal decide disclosure is appropriate — never the raw submission or submitter identity, to prevent retaliation.
- **Anonymous complaints**: supported as an option, but anonymous complaints cannot request the parent-notification loop (there's no one to notify) and are flagged differently in the Principal's queue since they can't be corroborated by follow-up questions.
- **Escalation**: unresolved complaints past an SLA (e.g., 7 days) auto-escalate to Principal even if raised to Admin only. Repeated complaints (≥3) about the same teacher trigger an automatic Principal alert (as in the original spec) — this alert is visible only to Principal/Admin, never broadcast.
- **Access control**: complaint records are a distinct permission from general student/parent data — a Class Teacher or Accountant has no access at all, by default, even though they can see other parent-linked data.

---

## 7. Timetable & Resource Allocation

Recommend **rule-based, not AI-based**, for V1: schools need predictable, explainable scheduling, and constraint-solving (even a simple greedy/backtracking algorithm) is well understood and auditable — AI-based scheduling adds cost and opacity without a clear V1 benefit.

Core constraints checked at assignment time:
- No teacher double-booked in the same period (as in the original example).
- No room/lab double-booked.
- Subject-specific requirements (e.g., Chemistry needs the lab).
- Teacher's maximum periods/day and weekly workload cap.
- Minimum free/prep periods per teacher.

Conflicts are surfaced immediately in the Admin UI when a manual assignment is attempted, and a "generate draft timetable" tool can auto-fill remaining slots respecting the same constraints, which Admin then reviews and locks.

---

## 8. Substitute Teacher Management

```
Teacher marks leave / is marked absent
        ↓
System identifies affected periods from timetable
        ↓
System filters teachers who are (a) free in that period, (b) qualified for the subject/class, (c) within workload limits
        ↓
Admin/Principal picks or auto-assigns substitute
        ↓
Timetable updated for that day only (original assignment unaffected)
        ↓
Substitute + affected class notified
        ↓
Audit log entry
```

Conflict prevention re-uses the same constraint engine as Section 7, applied to a single day rather than the full term.

---

## 9. Leave Management

**Student leave:** `Parent submits (dates + reason, optional document) → Class Teacher approves/rejects → Attendance auto-marked as "On Leave" (distinct from "Absent") for approved dates.`

**Teacher/Staff leave:** `Teacher submits → Principal/Admin approves/rejects → triggers Substitute Management (Section 8) if approved → Teacher's own attendance reflects leave, not absence.`

Leave balances (casual/sick/earned) are tracked per staff member; Admin configures entitlements per role.

---

## 10. Fees & Finance

Structure: a school defines one or more **Fee Structures** (e.g., "Grade 8 – 2026-27") composed of line items — tuition, transport, exam, activity — each with due dates and optional installment plans. Discounts/scholarships apply as adjustments against a structure, never by editing the base structure per-student (keeps the base auditable).

Supported: online payment gateway integration (Razorpay/Cashfree are common in India), auto-generated receipts, due-date reminders (staggered — e.g., 7 days, 1 day, on due date, then overdue), payment history, and refund workflow (Tier 3 — requires Admin approval).

**Separation of duties:** Accountant can collect and record payments and issue receipts, but cannot alter a fee structure or grant a discount without Admin approval (Tier 3) — this prevents a single role from both setting and collecting fees unchecked.

---

## 11. Transport Management

**Include in V1/Phase 3:** routes, stops, buses, driver/conductor records, student-to-route allocation, NFC boarding/drop-off attendance, parent notifications on boarding/drop-off.

**Optional/Phase 4:** live GPS tracking and "5 minutes before arrival" predictive notification — genuinely useful, but depends on reliable device/connectivity on buses and adds real-time infrastructure cost; schools can operate correctly without it (boarding/drop-off confirmation is the higher-value, lower-cost feature).

---

## 12. Library Management

Standard catalog (books, ISBN, authors, categories) plus issue/return/due-date/fine workflow, and per-student/teacher borrowing history. Treated as a self-contained module with its own permission set (Librarian role) — no dependency on academic/marks data beyond linking to Student ID.

---

## 13. Inventory & Asset Management

Assets (Asset ID, category, location, assigned-to, condition, purchase info, maintenance log, disposal record) with a simple audit history per asset. Lower priority than academic/attendance/fees — recommended for Phase 3, since most schools continue using existing manual asset registers early on without it blocking ERP adoption.

---

## 14. Certificates & Documents

Certificate generation (Bonafide, Study, Transfer Certificate, ID cards, report cards, fee receipts) is templated and populated from verified student data — never manually retyped, to avoid transcription errors on official documents. Issuance of high-stakes documents (Transfer Certificate) is Tier 4 (Section 3): Admin initiates, Principal approves, then the document is generated and locked (immutable, re-issuance creates a new versioned copy rather than overwriting).

---

## 15. Notifications & Automation

Event-driven notifications (attendance marked absent, fee due, exam result released, homework assigned, leave approved/rejected, teacher absent → Principal, complaint status change, announcements) are configurable per user for channel (push / SMS / in-app) and, where reasonable, frequency (e.g., daily digest vs. immediate) to avoid notification fatigue — a common complaint with Indian school apps that over-notify parents.

---

## 16. Role Dashboards

- **Principal:** student/attendance/teacher-attendance summary, pending approvals queue, fee collection summary, exam status, complaints needing attention, leave requests, alerts (e.g., repeated complaints).
- **Teacher:** today's timetable, pending attendance, pending marks entry, homework to review, own leave status, notifications.
- **Parent:** child's attendance, homework, marks (post-release), fee status, announcements, leave status, feedback/complaint tracker.
- **Admin:** operational overview, user management, module configuration, audit log access, data-quality flags (e.g., incomplete student records), reports.
- **Accountant:** fee collection dashboard, overdue list, reconciliation view — no academic widgets at all.

---

## 17. Audit Log & Data Security

Every Tier 2–4 change records: who, what field, previous value, new value, timestamp, reason, approver (if any), and device/IP where feasible. The audit log is **append-only** — no role, including Super Admin, can delete entries through the application; retention and purging (if ever needed for storage/compliance) is a separate, logged administrative operation with its own approval trail, not a user-facing delete.

---

## 18. Data Privacy (India Context)

Design should align with the **Digital Personal Data Protection (DPDP) Act, 2023** principles: purpose limitation (collect only what's needed), consent for processing (parent consent captured at admission for data use), data minimization, breach notification readiness, and a defined data retention/deletion policy for students who leave the school (retain academic records per applicable education-board/RTE requirements, but restrict access once the student exits).

**Never exposed to unauthorized roles:** medical/sensitive information (visible only to Admin/Principal/school nurse if that role exists, never to teachers by default), complaint submitter identity (Section 6), salary information (only the individual + Admin/Principal), and raw payment/financial instrument details (only Accountant/Admin, and never stored beyond what the payment gateway requires — card/bank details should never touch the school's own database; use tokenized payment gateway references only).

Passwords: hashed (never stored plain), with standard lockout/rate-limiting on login attempts; role-based session scoping so a compromised parent account cannot reach staff-only endpoints.

---

## 19. Offline & Low-Connectivity Support

Feasible offline: attendance marking (NFC scans cached locally, synced when connectivity returns), viewing already-downloaded timetable/homework/diary entries, and teacher mark entry drafts (synced, not submitted, until online — submission is a Tier-2+ action that should happen server-side to avoid conflicting concurrent edits).

**Requires internet:** payment processing, marks release/approval workflow, real-time notifications, complaint submission (needs confirmation of receipt), and anything touching Tier 3/4 approvals (these must be atomic against the live audit log to avoid conflicting approvals from two offline devices).

Conflict resolution for synced offline data: last-write-wins is unsafe for attendance/marks — instead, offline entries queue as "pending sync" and are applied through the normal Tier-2 logged-edit path rather than silently overwriting, so a genuine conflict (e.g., two teachers editing the same record while offline) is visible in the audit log rather than silently lost.

---

## 20. Web + Mobile Architecture

**Recommended stack (optimized for team size, cost, and Indian-school scale — thousands, not millions, of concurrent users per school):**

- **Backend:** Node.js with NestJS (or FastAPI if the team is more Python-leaning) — both offer strong typing/structure for a system with this many interrelated modules and permission rules, and both have mature ecosystems for RBAC, background jobs, and REST/GraphQL APIs.
- **Database:** PostgreSQL — relational integrity matters enormously here (a wrong foreign key between Student ID and Marks is a real-world problem, not a theoretical one); Supabase is a reasonable managed-Postgres option if the team wants faster setup with built-in auth/storage, at a monitored cost trade-off as the school count grows.
- **Mobile:** Flutter — single codebase for Android/iOS, which matters because most Indian schools' parent bases skew Android-heavy but iOS can't be ignored, and a two-codebase (native) approach is not justified for this team size/budget.
- **Web:** React (or Next.js if SSR/SEO for a public-facing school website is also wanted) for Admin/Principal/Teacher/Parent web portals.
- **Auth:** JWT-based sessions with role/permission claims, short-lived access tokens + refresh tokens; consider a managed auth provider (e.g., Supabase Auth or Auth0) only if it clearly reduces build time — otherwise a well-tested custom auth service is fine and keeps full control over the RBAC model in Section 2.
- **Notifications:** Firebase Cloud Messaging for push (free, works across Android/iOS), SMS via a local gateway provider (e.g., MSG91, Twilio has higher India costs), WhatsApp Business API as a Phase 4 addition given its approval/cost overhead.
- **File storage:** any S3-compatible object storage (AWS S3, or Backblaze B2 for lower cost) for certificates, documents, profile photos.
- **Background jobs:** a queue (BullMQ over Redis) for notification dispatch, report generation, and offline-sync reconciliation.
- **Redis:** caching + session/queue support, not a primary data store.

Why not Firebase-as-primary-database: Firestore's document model makes the strict relational/audit requirements here (foreign keys, transactional Tier-3/4 approvals, complex permission joins) harder to enforce correctly than a relational database — Firebase is used here only for what it's genuinely good at (push notifications, and optionally file storage/auth).

**API architecture:** REST is sufficient and simpler to reason about for this scope; GraphQL is not necessary unless the mobile team specifically wants flexible field selection to reduce payload size on low-bandwidth connections — worth reconsidering as a v2 investment, not a v1 requirement.

---

## 21. Phased Roadmap

**Phase 1 — MVP (target: a school can go fully digital for daily operations)**
Student/parent/teacher registration & RBAC core, attendance (manual + optional NFC), basic marks entry, homework/diary, announcements, basic fee tracking, audit log foundation.

**Phase 2 — Academic & Communication Depth**
Full examination workflow with approvals, report cards, timetable engine, leave management, substitute assignment, complaints/feedback, online fee payments, push/SMS notifications, teacher attendance & salary.

**Phase 3 — Breadth**
Transport (NFC boarding + optional GPS), library, sports/events/certificates, inventory/assets, class/school analytics dashboards, lesson planning/syllabus tracking, OCR-assisted mark entry.

**Phase 4 — Scale & Polish**
Multi-school/organization (Super Admin) support, predictive analytics (attendance-risk, performance trends), WhatsApp Business integration, offline-first mobile sync hardening, biometric attendance option, deeper parent-app personalization.

Each phase is scoped so that no later phase requires re-architecting the student/class/section/user data model established in Phase 1 — new modules attach to that stable core via foreign keys, not schema rewrites.
