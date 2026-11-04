# Feature Status by Role

Completed and pending APIs and features for each role, as of 2026-10-29.
See [STATUS.md](../STATUS.md) for platform status and
[role-scenarios.md](./role-scenarios.md) for detailed flows.

## Summary

Every API in [API's_modules.md](../API's_modules.md) is built. A comparison of the
catalog against the controllers found 336 catalog routes and 353 implemented routes:

- 334 match exactly.
- The other 2 (`/marks/:id/submit`, `/marks/:id/release`) appear in the catalog only
  as naming examples. They exist as `POST /marks/submit` and
  `POST /examinations/:id/release`.
- 19 routes go beyond the catalog (delivery retry, notification test route,
  substitute available-teacher list, and others).

What remains is features outside the catalog, plus built pieces not yet tested
against real services.

---

## Admin view

### Super Admin

| Done | Pending |
|---|---|
| Organization and schools: create, archive, restore | — |
| Users, invitations, activation, roles, permission catalog | — |
| Limited to its own organization | — |
| Audit and security logs | — |

### School Admin

| Done | Pending |
|---|---|
| Academic years: create, activate, rollover, close | Staff (teacher) attendance: not built |
| Classes, sections, subjects | Salary / payroll: not built |
| Staff with logins, section assignments, class teacher | Sports and events: not built |
| Student registration, archive, history, documents | Medical records and consent capture (DPDP Act): not built |
| Guardians and parent logins, enrollments, promote, transfer | NFC card capture screen: not built |
| Fee structures, payments, receipts, discounts, refunds | Real Razorpay/Cashfree payments: needs keys, untested |
| Timetable generator, substitutes | MFA login: untested |
| Complaints with SLA escalation, certificates | |
| Transport, library, assets, permission overrides | |
| Audit search and CSV export, dashboards, reports, analytics | |

### Accountant

| Done | Pending |
|---|---|
| Fee structures sent for approval, record and verify payments, receipts | Live payment gateway testing |
| Discount and refund requests (Tier 3 approval) | Payment reconciliation with the gateway: not built |
| Overdue list, fee reports, accountant dashboard | |
| Blocked from marks, attendance and complaints | |

## Principal view

| Done | Pending |
|---|---|
| Reads students, staff, attendance and school structure | Teacher attendance summary on the dashboard (no staff attendance yet) |
| Verify, lock and release results; reopen through Tier 4 approval | MFA login: untested |
| Approves Tier 3 changes; second approval on Tier 4 (tested end to end) | |
| Decides staff leave, manages timetable and substitutes | |
| Principal dashboard, reports, analytics, audit | |
| Handles complaints; the named teacher never sees them | |

## Teacher view

| Done | Pending |
|---|---|
| Attendance for assigned sections only: bulk entry, 48-hour edits, corrections | Lesson planning and syllabus tracking: not built |
| Homework: create, publish, grade, return | OCR-assisted mark entry: not built |
| Marks entry and bulk entry, submission, corrections | Own attendance (staff attendance): not built |
| Registers students and edits contact details; name or date-of-birth changes go to Tier 4 | |
| Decides student leave as class teacher; requests own leave with balance check | |
| Own timetable, substitute duties, dashboard | |
| Offline attendance and mark drafts with sync conflicts | |

## Student view

| Done | Pending |
|---|---|
| Sees only own profile, attendance, homework, marks and fees | Push notifications: sender built, not verified |
| Submits homework; graded work cannot be overwritten | Real online payment (dev order ids for now) |
| Report cards after results are released | Forgot password / OTP login: untested (needs an inbox) |
| Fee summary and online payment order | |
| Timetable, announcements, leave requests, complaints (optionally anonymous), feedback | |
| Library history, transport details, issued certificates | |

## Parent view

| Done | Pending |
|---|---|
| Linked children, parent dashboard, edits own contact details (Tier 1) | SMS (unverified) and WhatsApp (not built) alerts |
| Child's attendance, homework, results, fees, transport | Live bus location (GPS): not built |
| Leave requests, complaint tracking | |

---

## Remaining features and APIs

### Not built (new APIs needed)

1. **Staff attendance**: teacher check-in by NFC or manually; expected by the Principal dashboard.
2. **Salary / payroll**: salary structure and payslips, visible only to the staff member, Admin and Principal.
3. **Sports and events**: event calendar, participation, certificates.
4. **Lesson planning and syllabus tracking.**
5. **Medical records and consent**: parent consent at admission; medical data limited to Admin/Principal (DPDP Act).
6. **GPS bus tracking.**
7. **WhatsApp Business notifications.**
8. **OCR-assisted mark entry** and **biometric attendance** (later phase).

### Built but not verified

- Push, SMS and email (FCM, Twilio, Resend): no credentials yet.
- MFA, OTP, forgot/reset password, email verification.
- Razorpay/Cashfree with real keys.
- Physical NFC readers.
- Daily digest notifications: the preference flag exists; not confirmed that the delivery worker honours it.

### Needed to go live (not APIs)

- **Frontend (Next.js) and mobile app (Expo)**: not started; the largest remaining piece.
- **CI pipeline**: build, lint, `db:check-rls` and the e2e suite.
- **Background job queue** for large reports, which currently run synchronously.

## Recommended order

1. Frontend and mobile apps, since every role screen depends on them.
2. Staff attendance and payroll as the next backend module.
