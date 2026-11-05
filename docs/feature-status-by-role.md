# Feature Status by Role

What is done and what is not for each role, as of 2026-11-05.
See [STATUS.md](../STATUS.md) for platform status, [role-scenarios.md](./role-scenarios.md)
for detailed flows, and [apps/README.md](../apps/README.md) to run the apps.

## How to read this

Each feature has two statuses, because the API is far ahead of the apps:

- **API:** the backend route exists.
- **Screen:** a person can use the feature in an app.

| Value | Meaning |
|---|---|
| Done | Built and tested end to end, or for screens, in the app |
| Built, unverified | Built, but not tried with real data, hardware, or services |
| Not built | Does not exist yet |

Web screens were tested in Chrome on the real API. Phone screens install and run on
Android, but their real-data flows have not been checked by hand, so they are all
**Built, unverified**.

## Summary

| Role | App | Screens today | Biggest gap |
|---|---|---|---|
| School Admin | Web | Overview, attendance, students, approvals | Most setup and daily work has an API but no screen |
| Principal | Web | Overview, attendance, students, approvals | Cannot create a School Admin yet |
| Teacher | Mobile | Classes, mark attendance, NFC scan, student leave, notices | No marks or homework screens |
| Student | Mobile | Attendance, leave, notices | No homework, marks, or fees screens |
| Parent | Mobile | Attendance, leave, notices | Only sees the first linked child |
| Accountant | None | None | No screens at all |
| Super Admin | Web | Same web pages as School Admin | Role scope still to be decided |

Every API in [API's_modules.md](../API's_modules.md) is built, based on a comparison of
the catalog against the controllers on 2026-10-29.

---

## School Admin

| Feature | API | Screen |
|---|---|---|
| School overview, attendance trend and risk | Done | Done (web) |
| View attendance and export CSV | Done | Done (web) |
| Student list and search | Done | Done (web) |
| Assign an NFC card to a student | Done | Done (web) |
| Approve or reject Tier 3 and Tier 4 requests | Done | Done (web) |
| Academic years, classes, sections, subjects | Done | Not built |
| Staff, teacher logins, section assignments | Done | Not built |
| Register, edit, archive, restore students | Done | Not built |
| Guardians, parent logins, enrollment, promotion, transfer | Done | Not built |
| Mark or correct attendance | Done | Not built |
| Exams, marks, verify, lock, release | Done | Not built |
| Fee structures, payments, receipts, discounts, refunds | Done | Not built |
| Timetables and substitutes | Done | Not built |
| Student and staff leave decisions | Done | Not built |
| Complaints, certificates, announcements | Done | Not built |
| Transport, library, assets | Done | Not built |
| Users, roles, permission overrides | Done | Not built |
| Audit search, reports, analytics | Done | Not built |
| MFA login | Built, unverified | Not built |

**Not built or needs changing:**

- A School Admin can still assign the Principal and School Admin roles, which goes against
  the hierarchy in the [architecture doc](../school-erp-architecture.md) (section 2.4).
- A School Admin can file a Tier 4 change as Tier 3 through `POST /approval-requests`
  and approve it alone. See [Known problems](#known-problems).
- Staff attendance, payroll, sports and events, and medical records with consent.

## Principal

| Feature | API | Screen |
|---|---|---|
| School overview, attendance trend and risk | Done | Done (web) |
| View attendance and export CSV | Done | Done (web) |
| Student list and search (read-only) | Done | Done (web) |
| Approve or reject Tier 3 and Tier 4 requests | Done | Done (web) |
| Exams: create, verify, lock, release, reopen through Tier 4 | Done | Not built |
| Timetables and substitutes | Done | Not built |
| Student and staff leave decisions | Done | Not built |
| Complaints, announcements, homework | Done | Not built |
| Read staff, fees, transport, library, and assets | Done | Not built |
| Audit logs, reports, analytics | Done | Not built |
| MFA login | Built, unverified | Not built |

**Not built or needs changing:**

- Creating a School Admin. A Principal cannot create any accounts today.
- A Principal can also approve their own Tier 3 requests. See [Known problems](#known-problems).
- The teacher attendance summary on the dashboard, which depends on staff attendance.

## Teacher

Teachers can change attendance for their assigned classes and sections, and marks for
their assigned subjects in those classes. They can view student details and register
new students, but cannot edit details or request changes to them.

| Feature | API | Screen |
|---|---|---|
| See assigned classes and marking progress | Done | Built, unverified (mobile) |
| Mark attendance, and edit it within 48 hours with a reason | Done | Built, unverified (mobile) |
| Mark attendance by NFC or typed card ID | Done | Built, unverified (mobile); no real card tried |
| Decide student leave as class teacher | Done | Built, unverified (mobile) |
| Read notices | Done | Built, unverified (mobile) |
| Request a correction for attendance older than 48 hours | Done | Not built |
| Enter and submit marks, request mark corrections | Done | Not built |
| Homework: create, publish, grade, return | Done | Not built |
| Register a student | Done | Not built |
| View assigned students | Done | Not built |
| Own timetable, substitute duties, dashboard | Done | Not built |
| Request own leave and check balance | Done | Not built |
| Offline attendance and mark drafts | Done | Not built |

**Not built:** lesson planning and syllabus tracking, OCR mark entry, and staff attendance.

**To decide:** teachers can still manage homework and decide student leave as class teacher.

## Student

| Feature | API | Screen |
|---|---|---|
| Own attendance by month | Done | Built, unverified (mobile) |
| Request leave | Done | Built, unverified (mobile) |
| Read notices | Done | Built, unverified (mobile) |
| View own profile | Done | Not built |
| Homework: view and submit | Done | Not built |
| Released marks and report cards | Done | Not built |
| Fee summary | Done | Not built |
| Online fee payment | Built, unverified (dev order IDs) | Not built |
| Timetable | Done | Not built |
| Complaints and feedback | Done | Not built |
| Library history, transport details, issued certificates | Done | Not built |
| Forgot password and OTP login | Built, unverified | Not built |
| Push notifications | Built, unverified | Not built |

**Not built:** a student dashboard API. The dashboards that exist are for staff, parents, and leaders.

## Parent

| Feature | API | Screen |
|---|---|---|
| Child's attendance by month | Done | Built, unverified (mobile) |
| Request leave for a child | Done | Built, unverified (mobile) |
| Read notices | Done | Built, unverified (mobile) |
| Linked children and parent dashboard | Done | Not built |
| Edit own contact details (Tier 1) | Done | Not built |
| Child's homework, results, fees, transport | Done | Not built |
| Complaint tracking | Done | Not built |
| SMS alerts | Built, unverified | Not built |

**Not built:** switching between children in the app (it shows only the first linked
child), WhatsApp alerts, and live bus location.

## Accountant

| Feature | API | Screen |
|---|---|---|
| Fee structures sent for approval, payments, receipts | Done | Not built |
| Discount and refund requests (Tier 3) | Done | Not built |
| Overdue list, fee reports, dashboard | Done | Not built |

Accountants have no access to marks, attendance, or complaints.

**Not built or needs changing:**

- Any screen. The web portal sends Accountants to the mobile app, which has no fee screens.
- Payment reconciliation with the gateway. Live gateway payments are also untested.
- The Principal creating Accountants, which is the intended rule. Today a School Admin creates them.

## Super Admin

The scope of this role is still to be decided, so this reflects what exists today.

| Feature | API | Screen |
|---|---|---|
| Organization and schools: create, archive, restore | Done | Not built |
| Users, invitations, activation, roles, permission catalog | Done | Not built |
| Audit and security logs | Done | Not built |

Super Admin is limited to its own organization and has no seeded permissions for students,
attendance, marks, or fees.

---

## Known problems

1. **Approval tiers can be bypassed.** `POST /approval-requests` lets the caller choose the
   tier, and the approval engine does not stop people approving their own requests. A School
   Admin can file a Tier 4 change as Tier 3 and approve it alone. This route is closed for teachers.
2. **The account hierarchy is not built.** The Principal cannot create a School Admin, and a
   School Admin can assign the Principal role.
3. **A card ID is required to register a student.** A student cannot be registered first and
   given a card later.

## Features not built for any role

1. Staff attendance: teacher check-in by NFC or manually.
2. Salary and payroll.
3. Sports and events.
4. Lesson planning and syllabus tracking.
5. Medical records and consent (DPDP Act).
6. GPS bus tracking.
7. WhatsApp Business notifications.
8. OCR mark entry and biometric attendance (later phase).

## Built but not verified

- Push, SMS, and email (FCM, Twilio, Resend): no credentials yet.
- MFA, OTP, forgot and reset password, and email verification.
- Razorpay and Cashfree with real keys.
- Real NFC cards and readers, and the phone scan screen.
- Phone app flows on real data.
- Daily digest notifications: the preference exists, but it is not confirmed that the
  delivery worker honours it.

## Needed to go live

- Screens for the features marked **Not built** above.
- Backend hosting for the school demo.
- CI pipeline: build, lint, `db:check-rls`, and the e2e suite.
- A background job queue for large reports, which run synchronously today.
