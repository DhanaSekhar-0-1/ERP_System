# MVP Plan for the First School

The plan agreed with the client side on 2026-11-10 for the first school. It says who can do
what, what each MVP stage contains, and in what order MVP1 is built. Where another document
disagrees, this one wins. For what is built today, see [STATUS.md](../STATUS.md) and
[feature-status-by-role.md](./feature-status-by-role.md).

Interactive versions, kept in step with this file:

- Role plan with MVP filter: https://claude.ai/artifact/BcfDwNgaCWYZAzrv1yvFqp
- Teacher registration form preview: https://claude.ai/artifact/SrzKWSKLHW1JsVGERo9kwb
- Student registration form preview: https://claude.ai/artifact/5oKeAuxRZnjfcLmUDwsbNG

Status words used below: **Built** (works today), **Change** (works, but differently from the
plan), **New** (not built).

---

## 1. Logins

Six logins: **Super Admin, Principal, Admin (School Admin), Accountant, Teacher, Student.**
There is **no parent login** in the apps: the family uses the student's login. The parent
role and its API stay in the code, hidden, so it can return if a school asks.

| Role | Purpose |
|---|---|
| Super Admin | School owner or management. Everything except teacher salaries, bank details, teacher leave decisions and discount approval |
| Principal | Oversight and final approval: teacher leave, discounts, fee structures, salaries, TC, failed students, exam release |
| Admin | Runs the office: registers teachers and students, watches attendance, approves exam marks per section |
| Accountant | Fees, salary payments, leaving clearances. Logs in from MVP2 |
| Teacher | Own classes and subjects only |
| Student | Own records only; also used by the family |

The developer keeps a separate platform login above the school. The school owner gets a Super
Admin limited to their own school.

## 2. Who creates which accounts

| Account | Created by | Status |
|---|---|---|
| Principal, Admin, Accountant | Super Admin only | Built (2026-11-10) |
| Teacher | Super Admin or Admin, with an app-made Teacher ID | Built (2026-11-10) |
| Student | Super Admin or Admin, one by one or from Excel | Built (2026-11-10) |

A School Admin cannot give or change the Super Admin, School Admin, Principal or Accountant
roles, or change the users who hold them.

## 3. Rules agreed

### Approvals

Every approval request is raised from its own screen or route, which sets the right tier;
the general `POST /approval-requests` route no longer accepts them. Someone other than the
person who raised a request must approve it (a section transfer by a School Admin or Principal
is the one exception and applies at once).

| Change | Who decides | Status |
|---|---|---|
| Fee discount | Accountant requests with a reason; only the **Principal** approves, never their own request | Built (2026-11-10) |
| Teacher (staff) leave | Only the **Principal**; a rejection needs a reason; the teacher is notified | Built (2026-11-10) |
| Fee structure for the year | Accountant drafts, Principal approves | Built (2026-11-10); screens MVP3 |
| Teacher's new salary | Principal sets it after verifying the previous salary proof | New (MVP2) |
| Student leaving (TC) | Admin and Accountant check together, then the Principal approves | New (MVP2) |
| Failed students at promotion | Principal keeps back or promotes each one | New (MVP2) |
| Student leave | Class teacher | Built |
| Exam marks | Admin approves each section, Principal releases it | Built |

The Principal's own salary and leave are not kept in the app.

### Teacher registration (MVP1, details in MVP2)

- **Teacher ID made by the app:** `T` + 2-digit joining year + a running count of all teachers
  ever registered: `T26A05` is the 5th teacher, joined 2026; after `A99` comes `B01`. It never
  changes, is never reused, and is the login ID. Replaces today's typed employee number.
- **Subjects replace "designation":** one or more subjects, no limit; the first is the main one.
- **Required in MVP1:** name, phone, joining date, at least one subject. NFC card optional until
  cards arrive.
- **Built (2026-11-10):** `POST /staff` (School Admin or Super Admin) makes the Teacher ID from
  the per-school counter inside the same transaction, skipping any number already used, and a
  random first password such as `zr2k-yC9T` shown once and changed at first login (a pattern is
  not needed because the Admin hands it over in person). Subjects must come from the school's
  list (`GET /staff/teaching-subjects`: default subjects plus class subjects) and are saved in
  the school's spelling. Email is optional; when given, the teacher can sign in with it as well
  as the Teacher ID. Web: the Teachers page dialog, with a one-time panel showing the login.
- **MVP2:** previous schools and experience, last monthly salary with proof (payslip or bank
  statement), documents (experience letters, certificates, ID proof), PAN and Aadhaar (masked).
  These can be added at registration or later by the Admin, or by the teacher after login.

### Teacher salary and bank details (MVP2)

- Admin enters the previous salary at registration and cannot see salary after saving.
- The Principal verifies the proof (Amount entered → Proof uploaded → Verified by Principal)
  and sets the new salary. Salary history keeps the date each change starts.
- **Salary is visible only to the Principal, the teacher, and the Accountant** (who pays it).
  Super Admin cannot see it: the permission is locked so no override can grant it, and every
  view is logged. Whoever runs the database can still read it; the school is told this.
- **Bank details** are added by the teacher after login, once the salary is approved: account
  number, IFSC (bank and branch filled in from it), account type, and a cancelled cheque or
  passbook photo. They are not on the registration form.
- The Accountant checks bank details against the photo before the first salary; the account
  holder's name must match. The account number is stored encrypted.
- Principal and Accountant see the account as `XXXX6789`; the teacher sees it in full. On
  payday the Accountant uses a logged **Reveal** or the bank's bulk file. A change of account
  notifies the teacher and Principal and must be checked again. Admin and Super Admin see
  nothing.

### Student registration and login (MVP1)

- **Admission number** is entered by the school; the app suggests the next one and blocks
  repeats. It is the **login ID**.
- **First password:** first 4 letters of the family name (first letter capital), `@`, last 4
  digits of the parent's mobile: Reddy and 94401 23456 give `Redd@3456`; Rao gives `Rao@3210`.
  The student **must change it at first login**. Login lockout after 5 failures stays on.
- **Required:** admission number and date, class, section, first name, family name, gender,
  date of birth, parent's name, 10-digit parent mobile, Aadhaar, NFC card.
- **Aadhaar** is required, but a child without one yet is registered with the enrolment slip
  number (a school cannot refuse admission for lack of Aadhaar); Admin is reminded to add it.
  Everyone sees `XXXX XXXX 0123`; only the student and the Accountant (logged Reveal) see it
  in full.
- **Academic year** runs June to May and comes from the admission date (Nov 2026 → 2026–27).
- **Roll number** is the next free one in the section.
- **Optional in MVP1:** relation, other parent, second mobile, email, blood group, mother
  tongue, photo, address, PIN.
- **Checks on every field (form and import alike):** names in **English letters** only
  (letters, spaces, `.`, `'`, `-`; up to 80 characters), because school records use them and the
  family name makes the first password; admission number up to 40 letters, numbers, `/ - .`;
  dates must exist (31 February is refused); an enrolment slip number needs at least 14 digits,
  so an Aadhaar typed with 10 to 13 digits is caught as a typo; free text (address, previous
  school and so on) has a length limit and cannot contain `< >`, control characters, or start
  with `= + @`. Tested with a 52-row sheet of correct, false and manipulated data (2026-11-10):
  every correct row saved as typed, every wrong row refused with its sheet row and reason.
- **New to this school:** previous school name, last class passed, percentage in that class,
  and the previous school's TC uploaded. **Already studying here:** no previous-school details
  or documents.
  *Suggested, not yet confirmed:* accept a grade as well as a percentage; add the board; let
  the TC come later ("TC pending"), since admission cannot be delayed for it under the Right to
  Education Act; a "First school" choice that hides these fields for LKG–Class 1.
- **MVP2:** APAAR ID, social category, religion (Admin and Principal only), documents, health
  and emergency contact, brothers and sisters linked by the same parent mobile.
- **Excel import columns:** admission_no, admission_date, first_name, family_name, gender,
  date_of_birth, class, section, parent_name, parent_mobile, aadhaar_or_enrolment_no,
  nfc_card_id.

### New school year (MVP2)

- After the finals, every student moves to the **next class in the same section** (8-B to
  9-B), keeping the admission number and login.
- Failed students go to the Principal. Students with an open leaving request wait. Class 10 is
  marked as passed out.
- Attendance starts fresh each year. Earlier years' attendance, marks, receipts and report cards
  stay under their old class, and the student can download them class by class, attendance
  month by month.

### Leaving the school and TC (MVP2)

1. The student requests on the app, or the Admin raises it for a parent who visits.
2. At the same time: the Admin checks records, library books and ID card; the Accountant
   confirms no dues (ticked by hand until fees arrive in MVP3).
3. The Principal approves, and a numbered TC is issued that cannot be edited.
4. The student is marked Left. The login stays read-only for 30 days, then closes. Records are
   kept.

Any step can send it back with a reason; the family can cancel while it is pending.

### Announcements and events (MVP2)

- Super Admin, Principal and Admin post to the whole school; teachers only to their own classes.
  Students cannot post.
- Each post has a type (event, fee reminder, holiday, emergency, general), a message, optional
  images and an end date. It scrolls in a banner at the top of the app until the end date and
  sends a notification to its audience.
- Only Super Admin, Principal and Admin post emergencies, which stay pinned in red.

### Teacher attendance (MVP1, decided 2026-11-10)

Teachers check in and check out on the phone app. NFC check-in can come later.

- **At school only:** check-in and check-out work only when the phone's location is within the
  school's radius (default 200 m) of the school location saved in settings. A reading less
  accurate than 150 m is refused ("move outside or try again"). Until the school location is
  saved, check-in is refused with a message telling the Admin to set it. A phone with a fake
  location app can still cheat; the Admin dashboard and corrections are the check on that.
- **Late:** the school sets a "late after" time (default 9:15 am, school time zone). A check-in
  after it is recorded as Late.
- **Check-out:** once per day, after checking in. Hours at school are shown to the Admin.
- **One record per teacher per day.** A teacher on approved leave shows as On leave and
  cannot check in that day.
- **Corrections:** the School Admin or Super Admin can mark or change a teacher's day (Present,
  Late, Absent, On leave) with a reason, for example a forgotten phone. Every correction is
  audited and shows "corrected by" on the record.
- **Not checked in** by the end of the day counts as Absent on the dashboard; nothing is written
  for those days unless the Admin corrects it.
- **Settings** (Admin, web Settings page): school location (use this device's location or type
  latitude and longitude), radius, and the late time.
- **Privacy:** only the distance from school and whether it was inside the radius are kept, not
  the raw location.
- **Built (2026-11-10):** table `staff_attendance` (migration `20261110130000_staff_attendance`);
  routes under `/staff-attendance`: `me/today`, `check-in`, `check-out` (teachers),
  `GET /` for a day's list with a summary (School Admin, Principal, Super Admin), `PUT /:staffId`
  for corrections and `GET`/`PUT settings` (School Admin, Super Admin); permissions
  `staff-attendance:check-in`, `:read`, `:manage`. Phone: "My attendance today" card on the
  teacher home (expo-location). Web: "Teacher check-in" card on Settings. The correction screen
  is part of the dashboard (6b). Days are counted in the school's time zone from school settings
  (Asia/Kolkata when unset).

### Admin attendance dashboard (MVP1)

One web page for the School Admin, Principal and Super Admin:

- **Today:** student attendance by class and section (present, absent, on leave, not marked
  yet), with a class and section filter.
- **Teachers today:** checked in, late, on leave, not checked in, with check-in and check-out
  times; the Admin can correct any row from here.
- **Overall %:** each student's attendance for the academic year so far, counted from the
  admission date for students who joined mid-year.
- **Student details page:** click a student to see their details and monthly attendance.
- **Built (2026-11-10):** web Attendance page (date picker, summary tiles, Teachers today with a
  Correct dialog, sections with a class filter, a section's students with today's status and
  year-to-date %, CSV export kept) and `/students/:id` details page. Routes
  `GET /attendance-dashboard`, `/attendance-dashboard/sections/:id`,
  `/attendance-dashboard/students/:id` (leaders; the student route also follows the normal
  student access rules). The % counts only marked days, leaving out leave and excused days, so
  a student who joined mid-year is counted from admission; below 75% shows in red.

---

## 4. MVP stages

### MVP1: shown to the client (confirmed 2026-11-10)

Attendance, registering people, and leave.

1. Super Admin creates Principal and Admin accounts; Admin cannot create senior accounts.
2. Teacher registration, basic form.
3. Student registration, one by one or from Excel, with admission-number login.
4. Classes, sections and teacher assignments (built).
5. Student attendance by the class teacher on web, phone or NFC (built).
6. Teacher check-in and check-out on the phone, only at school (location), with a late time.
7. Admin dashboard: today's attendance by class and section, overall %, teachers present, a
   student details page.
8. Leave: student to class teacher (built); teacher to Principal only (built 2026-11-10).
9. Hide the parent login and every module not listed here.
10. Test the phone app by hand on real devices.

### MVP2: next

Announcements and events; exams, results and report cards (mostly built, switched on); teacher
profile after login; salary verification and setting; bank details; Accountant login for bank
checks, no-dues ticks and Aadhaar Reveal; promotion; leaving and TC; previous classes on the
student portal; audit log screen.

### MVP3: after the school pays

Accountant fee screens; fees, receipts and pending dues; discount requests with Principal
approval (rule built); fee structure approval; salary payments; SMS or WhatsApp (the school pays
per message); timetable and homework; a second school on the same system.

---

## 5. MVP1 build order

Branch `feature/mvp1`, one commit per step, end-to-end suite run each time.

| # | Step | Status |
|---|---|---|
| 1 | Create the branch | Done 2026-11-10 |
| 2 | Account, leave and discount rules | Done 2026-11-10 (`c66f3c0`) |
| 2a | Approval loophole: requests only from their own routes; someone other than the requester must approve | Done 2026-11-10 |
| 3 | Database changes for teacher and student fields, and moving existing records over | Done 2026-11-10 (migration `20261110100000_mvp1_registration_fields`) |
| 4 | Student creation: admission-number login, first password, forced change, import endpoint with a dry run | Done 2026-11-10 |
| 5 | Teacher registration: app-made ID, subjects | Done 2026-11-10 |
| 5a | "Choose a new password" screen in the web and phone apps (the server already blocks other routes until the first password changes) | Done 2026-11-10 |
| 6a | Teacher check-in and check-out (location, late time, Admin corrections, settings) | Done 2026-11-10 |
| 6b | Admin attendance dashboard (today by class and section, teachers today, overall %, student details) | Done 2026-11-10 |
| 7 | Leave screens on web and phone: teacher's own leave request (phone), Principal decides teacher leave (web, reason to reject), Admin sees approved leaves (web). Student leave request and class-teacher decision already exist on the phone | Next (resume here) |
| 8 | Hide parent login and unused modules; host; Android build; device test | |

Admin and Super Admin work on the **web**; the phone app is for teachers and students.

**How the data is stored (step 3):** the parent is the existing Guardian record linked to the
student as primary guardian (name, mobile, relation), so brothers and sisters can share one
parent later. The family name is the existing `lastName`. Aadhaar is never stored in plain
text: an encrypted value, the last 4 digits for display, and a keyed hash that blocks the same
number twice in a school. The Teacher ID is written to the existing `employee_no`, so older
staff keep their numbers; a per-school counter (`id_sequences`) makes the next one. New fields
are optional in the database because existing records lack them; the API enforces what is
required.

## 6. Excel import

- **Endpoint (built):** `POST /students/import` with `{ "dryRun": true, "rows": [...] }`, one
  object per sheet row keyed by the column names above (plus optional roll_number,
  admission_type, parent_relation, other_parent_name, other_parent_mobile, email, blood_group,
  mother_tongue, address, pin_code, previous_school, last_class_passed, previous_percentage,
  previous_tc_number). Class may be written "Class 8" or "8"; dates as 12/06/2026 or
  2026-06-12; gender as M/F; one column holds Aadhaar or, when not issued, the slip number. Up to
  500 rows a call; the response lists problem rows, rows already registered (skipped) and, after
  a real run, each login with its first password.
- **Script (built):** `npm run import:students` in `backend`. `--template` writes a blank
  sheet with the right columns, two example rows and a "How to fill" sheet; `--file` runs a dry
  run and lists problems by **sheet row number**; adding `--commit` imports (only when no row
  has a problem) and writes each login and first password to a CSV. It reads .xlsx or .csv,
  real Excel date cells and numbers typed as numbers, skips blank lines, accepts common heading
  variants (Adm No, DOB, Surname, Aadhar), checks duplicates across the whole file, and always
  leaves out the template's example rows (admission numbers starting with EXAMPLE). The logins
  file holds first passwords: hand them out, then delete it (git ignores it).
- **Pilot:** no screen. A script run by the developer sends the school's Excel file to the
  import endpoint: a dry run lists problem rows (for example "Row 14: parent mobile has 9
  digits"), the school fixes the sheet, then the real run creates the records. Re-running skips
  admission numbers that already exist. Never paste rows straight into the database: students
  would get no login.
- **After the pilot:** an "Import from Excel" button on the existing web Students page, for
  Admin and Super Admin only: Upload → Check → Import.
- Teachers are registered with the web form; there are only a few.

## 7. Pilot (one month)

- Two or three classes of 2026–27, with the school's written consent to hold the data.
- A separate database for the client, not the development one, with a nightly backup.
- For the pilot, Aadhaar and the NFC card may be optional if the school has not collected them:
  set `registration.requireAadhaar` / `registration.requireNfcCard` to `false` in the school
  settings metadata.
- Every school day: class teachers mark attendance on the phone before a set time (for example
  10 am); the Admin checks the dashboard; the developer checks marking and errors each evening;
  a WhatsApp group for problems.
- Success: attendance marked every school day for every pilot section without the developer's
  help.

## 8. Open items

- The first-password pattern can be guessed by classmates; the forced change at first login is
  what keeps it safe, so it must not be skippable (built: the server refuses every other route,
  and both apps show only the choose-a-new-password screen).
- A fake-location app can cheat teacher check-in; the dashboard and corrections are the check.
- Server packages flagged by `npm audit` (high and critical) must be updated before the pilot.
- Nothing has been tried on a real phone yet: phone screens, check-in at school, NFC cards.
- Suggested, not yet confirmed: grade instead of percentage, board, "TC pending" and "first
  school" for students new to the school (section 3).
- Where work stopped and how to resume: [STATUS.md section 0](../STATUS.md#0-resume-here-stopped-2026-11-10-end-of-day).
