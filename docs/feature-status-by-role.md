# Feature Status by Role

What is done, what is not, and what comes next for each role, as of 2026-11-09.
See [STATUS.md](../STATUS.md) for platform status, [role-scenarios.md](./role-scenarios.md)
for detailed flows, and [apps/README.md](../apps/README.md) to run the apps.

## How to read this

Each feature has two statuses, because the API is ahead of the apps:

- **API:** the backend route exists and the server enforces who may use it.
- **Screen:** a person can use the feature in an app.

| Value | Meaning |
|---|---|
| Done | Built and tested end to end, or for screens, checked in the browser |
| Built, unverified | Built and type-checked, but not tried with real data, hardware, or services |
| Not built | Does not exist yet |

Web screens were checked in the browser on the real API. Phone screens install and run on
Android, but their flows have not been checked by hand on a device, so they are all
**Built, unverified**.

## Summary

| Role | App | Screens today | Biggest gap |
|---|---|---|---|
| Super Admin | Web | Every School Admin page | Full access in the API, but the same missing screens as School Admin, and no organization, user or role screens |
| School Admin | Web | Overview, Classes & Sections, Teacher Assignments, Exams & Reports, Teachers, Students, Attendance, Approvals, Settings | No screens for student registration, fees, timetables, leave or academic years |
| Principal | Web | Same pages, read-only where they cannot change things; releases exam sections | Cannot create a School Admin |
| Teacher | Web and mobile | My classes, Attendance (class teacher), Marks entry, Slip tests; mobile Attendance, Subjects, Leave, Notices | No homework screens; phone marks entry untested on a device |
| Student | Mobile | Attendance, Results, Leave, Notices | No homework, fees or timetable screens |
| Parent | Mobile | Attendance, Results, Leave, Notices | Sees only the first linked child |
| Accountant | None | None | No screens at all |

Every API in [API's_modules.md](../API's_modules.md) is built, based on a comparison of the
catalog against the controllers on 2026-10-29. Since then, class and subject management,
teacher assignments, exam types, slip tests and per-section exam release were added.

---

## Super Admin

The developer and organization account, with **full access** since 2026-11-10. It works across
its organization for schools and users, and inside its own school for everything else. The seed
gives it every permission any role has (75 today), so a permission added to another role
reaches Super Admin the next time `npm run prisma:seed` runs.

| Feature | API | Screen |
|---|---|---|
| Organization and schools: create, edit settings, archive, restore | Done | Not built |
| Users: create, invite, activate, deactivate; assign any role, including Super Admin | Done | Not built |
| Roles, role permissions, per-user permission overrides | Done | Not built |
| Classes, sections and per-section subjects; default subject list | Done | Done (web) |
| Register teachers; subject teachers and class teachers | Done | Done (web) |
| Exams: create for one or several classes, add subjects; enter and correct marks | Done | Done (web), except marks entry |
| Exam approval: approve sections and release them (both steps) | Done | Done (web) |
| Approval requests: fills any slot, including the Principal's on Tier 4 | Done | Done (web) |
| Students and attendance: view, plus register, edit, archive; mark and correct attendance | Done | View only (web) |
| Academic years, enrollment, promotion, transfers; guardians and parent logins | Done | Not built |
| Fees, payments, discounts (applied directly), refunds | Done | Not built |
| Leave, timetables, substitutes, homework, announcements, complaints, certificates | Done | Not built |
| Transport, library, assets, offline sync, notifications admin | Done | Not built |
| Audit and security logs, reports, analytics | Done | Not built |

**Things to know:**

- It can give both exam approvals, so it can release results on its own.
- On a Tier 4 request it can fill either slot, but one person still cannot approve the same
  request twice, so a second approver is always needed.
- It can give any user extra permissions, and no check stops it doing so for itself.
- Nothing is deleted permanently: schools, users and students are archived or deactivated.

**Next:** screens for organizations, schools, users and roles.

## School Admin

Runs the school day to day.

| Feature | API | Screen |
|---|---|---|
| Overview: attendance today, weekly trend, students at risk | Done | Done (web) |
| Classes and sections: create, rename, delete when empty; Section A and default subjects are added automatically | Done | Done (web) |
| Per-section subjects: add, rename, remove, switch optional ones on and off | Done | Done (web) |
| Default subject list for new sections (Sanskrit optional) | Done | Done (web) |
| Register teachers with a login | Done | Done (web) |
| One teacher per section subject; one class teacher per section | Done | Done (web) |
| Exams: FA1-FA4, Q1-Q3, Pre-public (Class 10), Other; for several classes at once | Done | Done (web) |
| Approve exam marks per section, or every ready section at once; send a section back | Done | Done (web) |
| Approve and release slip tests | Done | Done (web) |
| Student list and search; assign NFC cards | Done | Done (web) |
| Attendance view and CSV export | Done | Done (web) |
| Approve Tier 3 and Tier 4 change requests | Done | Done (web) |
| Academic years, enrollment, promotion, transfers | Done | Not built |
| Register and edit students; guardians and parent logins | Done | Not built |
| Mark or correct attendance on the web | Done | Not built |
| Fees, payments, receipts, discounts, refunds | Done | Not built |
| Timetables, substitutes, student and staff leave | Done | Not built |
| Complaints, certificates, announcements, homework | Done | Not built |
| Transport, library, assets | Done | Not built |
| Users, roles, overrides; audit search and reports | Done | Not built |

**Problems:**

- A School Admin can still assign the Principal and School Admin roles, which goes against
  the hierarchy in the [architecture doc](../school-erp-architecture.md) (section 2.4).
- A School Admin can file a Tier 4 change as Tier 3 through `POST /approval-requests` and
  approve it alone. See [Known problems](#known-problems).

**Next:** student registration and enrollment screens, then academic years, fees and
timetables.

## Principal

Oversight and final approval.

| Feature | API | Screen |
|---|---|---|
| Overview, attendance, students | Done | Done (web) |
| Classes, sections, subjects and teacher assignments: view | Done | Done (web, read-only) |
| Exams: create, add classes and subjects | Done | Done (web) |
| Release approved exam sections, one at a time or all approved at once; send back | Done | Done (web) |
| Approve Tier 3 changes; give the Principal's approval on Tier 4 | Done | Done (web) |
| Student and staff leave decisions | Done | Not built |
| Timetables and substitutes | Done | Not built |
| Complaints, announcements, homework | Done | Not built |
| Audit logs, reports, analytics | Done | Not built |

**Not built:** creating a School Admin (the Principal cannot create accounts), and the
teacher attendance summary, which needs staff attendance.

**Next:** account creation for School Admins and Accountants, as the intended hierarchy says.

## Teacher

Access comes from the teacher's current assignments, read on every request, so a change
by the School Admin applies at once.

| Feature | API | Screen |
|---|---|---|
| My classes: own subjects and class-teacher sections | Done | Done (web); Built, unverified (mobile) |
| Daily attendance, only as class teacher of the section | Done | Done (web); Built, unverified (mobile) |
| NFC or typed card attendance | Done | Built, unverified (mobile); no real card tried |
| Marks entry for own subjects; save and submit | Done | Done (web); Built, unverified (mobile) |
| Exams grouped as waiting, approved, or released | Done | Done (web) |
| Create slip tests for own section and subject | Done | Done (web) |
| Decide student leave as class teacher | Done | Built, unverified (mobile) |
| Read notices | Done | Built, unverified (mobile) |
| Mark corrections after submission (Tier 3) or release (Tier 4) | Done | Not built |
| Homework: create, publish, grade, return | Done | Not built |
| Register students; view assigned students | Done | Not built |
| Own timetable, substitute duties, own leave | Done | Not built |

**Cannot do:** edit student details, change classes, sections, subjects or assignments, or
mark attendance for a section where they are not the class teacher.

**Things to know:** a teacher sees students of their assigned classes from every academic
year, not only the current one.

**Next:** homework screens and mark correction requests.

## Student

| Feature | API | Screen |
|---|---|---|
| Own attendance by month | Done | Built, unverified (mobile) |
| Released results and report cards | Done | Built, unverified (mobile) |
| Request leave | Done | Built, unverified (mobile) |
| Read notices | Done | Built, unverified (mobile) |
| Homework: view and submit | Done | Not built |
| Fee summary; online payment | Done; payment Built, unverified | Not built |
| Timetable, complaints, feedback | Done | Not built |
| Library, transport, certificates | Done | Not built |
| Forgot password, OTP login, push notifications | Built, unverified | Not built |

A student sees an exam's marks only after the Principal releases their section.

**Not built:** a student dashboard.

**Next:** homework and timetable screens.

## Parent

| Feature | API | Screen |
|---|---|---|
| Child's attendance by month | Done | Built, unverified (mobile) |
| Child's released results and report cards | Done | Built, unverified (mobile) |
| Request leave for a child | Done | Built, unverified (mobile) |
| Read notices | Done | Built, unverified (mobile) |
| Parent dashboard; edit own contact details | Done | Not built |
| Child's homework, fees, transport; complaints | Done | Not built |
| SMS alerts | Built, unverified | Not built |

**Not built:** switching between children (the app shows only the first linked child),
WhatsApp alerts, and live bus location.

**Next:** a child switcher.

## Accountant

| Feature | API | Screen |
|---|---|---|
| Fee structures sent for approval, payments, receipts | Done | Not built |
| Discount and refund requests (Tier 3) | Done | Not built |
| Overdue list, fee reports, dashboard | Done | Not built |

Accountants have no access to marks, attendance or complaints. The web portal sends them
to the phone app, which has no fee screens.

**Not built:** any screen, payment reconciliation, and creation by the Principal (today a
School Admin creates Accountants).

**Next:** web fee screens.

---

## Known problems

1. **Approval tiers can be bypassed.** `POST /approval-requests` lets the caller choose the
   tier, and the approval engine does not stop people approving their own requests. A School
   Admin can file a Tier 4 change as Tier 3 and approve it alone. Closed for teachers only.
2. **The account hierarchy is not built.** The Principal cannot create a School Admin, and a
   School Admin can assign the Principal role.
3. **A card ID is required to register a student.**
4. **Older school-wide subjects** (created before subjects became per-section) do not appear
   on the new screens. Assignments that use them still work, and they cover the section
   subjects with the same code in exams.
5. **Sections with no students** count as complete, so they must still be approved and
   released before an exam shows as fully released.
6. **Supabase-side sign-outs** take effect when the token expires (usually within an hour),
   because tokens are now checked locally. Sign-outs through the app apply at once.
7. **The permission cache is per server.** With several backend servers, a role change could
   take up to a minute to reach the others.

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

- Push, SMS and email (FCM, Twilio, Resend): no credentials yet.
- MFA, OTP, forgot and reset password, and email verification.
- Razorpay and Cashfree with real keys.
- Real NFC cards and readers.
- Phone app flows, including marks entry and Results, on a device.

## What comes next

1. Change the passwords that are readable in the repository's history.
2. Fix the approval-tier gap and build the account hierarchy.
3. Student registration, enrollment and academic-year screens for the School Admin.
4. Test the phone app on a device with real data and real NFC cards.
5. Host the backend for the school demo.
6. Homework, fees and timetable screens.
7. CI running build, lint, `db:check-rls` and the e2e suite.
