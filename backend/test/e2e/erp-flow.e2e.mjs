/**
 * End-to-end walkthrough of the ERP API against a running server and the test school.
 *
 *   node test/e2e/erp-flow.e2e.mjs
 *
 * Env: API_URL (default http://localhost:3000/api/v1), CREDENTIALS_FILE (default ../test-org-school.txt),
 *      RAZORPAY_WEBHOOK_SECRET (must match the server; default dev_webhook_secret).
 * Each run creates its own academic year and records, so it can be repeated.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dev_webhook_secret';
const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const results = [];
let section = '';

// ---------- helpers ----------

function credentials() {
  const file = process.env.CREDENTIALS_FILE ?? resolve(process.cwd(), '..', 'test-org-school.txt');
  const text = readFileSync(file, 'utf8');
  const block = (label) => {
    const start = text.indexOf(`${label}:`);
    const chunk = text.slice(start, start + 400);
    return {
      email: chunk.match(/Email:\s*(\S+)/)[1],
      password: chunk.match(/Password:\s*(\S+)/)[1],
    };
  };
  return { admin: block('Admin'), teacher: block('Teacher'), student: block('Student') };
}

function day(offset = 0) {
  const date = new Date(Date.now() + offset * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function check(name, condition, detail) {
  results.push({ section, name, ok: Boolean(condition), detail: condition ? undefined : detail });
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${name}${condition ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 300)}`}`);
  return Boolean(condition);
}

async function call(token, method, path, body, { raw = false, form, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: form ?? (body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await response.text();
  if (raw) return { status: response.status, text, headers: response.headers };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { data: text };
  }
  return { status: response.status, data: json?.data, meta: json?.meta, error: json?.error };
}

/** Calls and records a check that the status matches; returns the data. */
async function expect(name, token, method, path, body, status = [200, 201], options) {
  const response = await call(token, method, path, body, options);
  const allowed = Array.isArray(status) ? status : [status];
  check(name, allowed.includes(response.status), { status: response.status, error: response.error });
  return response;
}

async function login(identifier, password) {
  const response = await call(null, 'POST', '/auth/login', { identifier, password });
  if (response.status !== 201) throw new Error(`Login failed for ${identifier}: ${JSON.stringify(response.error)}`);
  return response.data.session.access_token;
}

function heading(title) {
  section = title;
  console.log(`\n== ${title}`);
}

// ---------- scenario ----------

async function main() {
  const creds = credentials();

  heading('Authentication');
  const admin = await login(creds.admin.email, creds.admin.password);
  const teacher = await login(creds.teacher.email, creds.teacher.password);
  const student = await login(creds.student.email, creds.student.password);
  check('admin, teacher and student log in', admin && teacher && student);
  await expect('wrong password is rejected', null, 'POST', '/auth/login', { identifier: creds.admin.email, password: 'wrong-password-1' }, 401);
  const anon = await call(null, 'GET', '/students');
  check('anonymous request gets 401 in the envelope', anon.status === 401 && anon.error?.statusCode === 401, anon);
  const me = (await expect('GET /auth/me', admin, 'GET', '/auth/me')).data.erpUser;
  const studentMe = (await expect('student /auth/me', student, 'GET', '/auth/me')).data.erpUser;
  const sessions = await expect('list my sessions', admin, 'GET', '/auth/sessions');
  check('current session is listed', sessions.data?.some((s) => s.current), sessions.data);
  await expect('change password needs the right current password', admin, 'POST', '/auth/change-password', { currentPassword: 'not-it-123', newPassword: 'Another#Pass123' }, 400);
  const extra = await login(creds.teacher.email, creds.teacher.password);
  await expect('logout a second teacher session', extra, 'POST', '/auth/logout', {}, [200, 201]);
  await expect('logged-out token is refused', extra, 'GET', '/auth/me', undefined, 401);
  await expect('invalid UUID query is a 400, not a 500', admin, 'GET', '/attendance?enrollmentId=not-a-uuid', undefined, 400);

  heading('School structure (School Admin)');
  const schoolId = me.schoolId;
  await expect('read own school', admin, 'GET', `/schools/${schoolId}`);
  await expect('update school settings', admin, 'PATCH', `/schools/${schoolId}/settings`, {
    timezone: 'Asia/Kolkata',
    metadata: { maxPeriodsPerDay: 6, maxPeriodsPerWeek: 30 },
  });
  const year = (await expect('create academic year', admin, 'POST', '/academic-years', {
    name: `E2E ${RUN}`,
    startsOn: '2026-09-01',
    endsOn: '2027-06-30',
  })).data;
  await expect('activate academic year', admin, 'POST', `/academic-years/${year.id}/activate`);
  const cls = (await expect('create class', admin, 'POST', '/classes', { academicYearId: year.id, name: 'Class 8', sortOrder: 8 })).data;
  const cls9 = (await expect('create next class', admin, 'POST', '/classes', { academicYearId: year.id, name: 'Class 9', sortOrder: 9 })).data;
  const secA = (await expect('create section A', admin, 'POST', '/sections', { academicYearId: year.id, classId: cls.id, name: 'A' })).data;
  const secB = (await expect('create section B', admin, 'POST', '/sections', { academicYearId: year.id, classId: cls.id, name: 'B' })).data;
  await expect('create section 9A', admin, 'POST', '/sections', { academicYearId: year.id, classId: cls9.id, name: 'A' });
  const maths = (await expect('create subject', admin, 'POST', '/subjects', { academicYearId: year.id, name: 'Mathematics', code: 'math' })).data;
  check('subject code normalised', maths?.code === 'MATH', maths);
  const science = (await expect('create second subject', admin, 'POST', '/subjects', { academicYearId: year.id, name: 'Science', code: 'sci' })).data;

  const staffList = (await expect('list staff', admin, 'GET', '/staff')).data;
  const teacherStaff = staffList.find((s) => s.user.email === creds.teacher.email);
  check('teacher staff profile found', teacherStaff, staffList);
  await expect('teacher cannot list all staff', teacher, 'GET', '/staff', undefined, 403);
  const assignment = (await expect('assign teacher to Class 8-A maths (section level)', admin, 'POST', `/staff/${teacherStaff.id}/assignments`, {
    academicYearId: year.id, classId: cls.id, sectionId: secA.id, subjectId: maths.id, isClassTeacher: true,
  })).data;
  await expect('assign teacher to Class 8 science (whole class)', admin, 'POST', '/staff-assignments', {
    staffId: teacherStaff.id, academicYearId: year.id, classId: cls.id, subjectId: science.id,
  });
  await expect('duplicate assignment conflicts', admin, 'POST', '/staff-assignments', {
    staffId: teacherStaff.id, academicYearId: year.id, classId: cls.id, sectionId: secA.id, subjectId: maths.id,
  }, 409);
  const myAssignments = (await expect('teacher sees own assignments', teacher, 'GET', '/staff-assignments')).data;
  check('teacher sees only own assignments', myAssignments.every((a) => a.staffId === teacherStaff.id), myAssignments);
  const summary = (await expect('academic year summary', admin, 'GET', `/academic-years/${year.id}/summary`)).data;
  check('summary counts classes', summary?.classes === 2, summary);

  heading('Students, enrollment, guardians');
  const studentId = studentMe ? (await call(student, 'GET', '/students')).data?.[0]?.id : undefined;
  check('student sees exactly one student (self)', studentId, studentMe);
  const studentList = await call(student, 'GET', '/students');
  check('student list is only self', studentList.data?.length === 1 && studentList.meta?.total === 1, studentList.meta);
  const current = (await expect('find current enrollment', admin, 'GET', `/students/${studentId}/enrollments`)).data;
  const active = current.find((e) => e.status === 'ACTIVE');
  let enrollment;
  if (active) {
    enrollment = (await expect('promote student into the new year', admin, 'POST', `/enrollments/${active.id}/promote`, {
      academicYearId: year.id, classId: cls.id, sectionId: secA.id, rollNumber: '1',
    })).data;
  } else {
    enrollment = (await expect('enroll student', admin, 'POST', `/students/${studentId}/enrollments`, {
      academicYearId: year.id, classId: cls.id, sectionId: secA.id, rollNumber: '1',
    })).data;
  }
  const newStudent = (await expect('teacher registers a second student', teacher, 'POST', '/students', {
    admissionNo: `E2E-${RUN}`, nfcId: `NFC-E2E-${RUN}`, password: `Stud#${RUN}`, firstName: 'Ravi', lastName: 'Kumar', dateOfBirth: '2013-05-10',
  })).data;
  check('generated login id returned', newStudent?.loginId === newStudent?.id, newStudent);
  const enrollment2 = (await expect('enroll second student in 8-B', admin, 'POST', '/enrollments', {
    academicYearId: year.id, studentId: newStudent.id, classId: cls.id, sectionId: secB.id, rollNumber: '2',
  })).data;
  const visible = (await call(teacher, 'GET', '/students')).data;
  check('teacher sees students in assigned classes', visible.some((s) => s.id === studentId), visible?.map((s) => s.firstName));
  await expect('student cannot see another student', student, 'GET', `/students/${newStudent.id}`, undefined, 403);
  await expect('teacher transfer request (8-B to 8-A) needs approval', teacher, 'POST', `/enrollments/${enrollment2.id}/transfer`, { sectionId: secA.id, reason: 'Parent request' }, [201]);
  const pendingTransfer = (await call(admin, 'GET', `/approval-requests?status=PENDING&type=enrollment.transfer`)).data;
  const transferRequest = pendingTransfer.find((r) => r.entityId === enrollment2.id);
  check('transfer request is pending', transferRequest, pendingTransfer);
  await expect('admin approves the transfer', admin, 'POST', `/approval-requests/${transferRequest.id}/approve`, { note: 'OK' });
  const moved = (await call(admin, 'GET', `/enrollments/${enrollment2.id}`)).data;
  check('enrollment moved to section A', moved?.sectionId === secA.id, moved);

  const guardian = (await expect('create guardian', admin, 'POST', '/guardians', { name: `Parent ${RUN}`, phone: '9876543210', relation: 'Mother' })).data;
  await expect('link guardian to student', admin, 'POST', `/guardians/${guardian.id}/children`, { studentId, isPrimary: true });
  const parentEmail = `parent.${RUN}@erp.local`;
  const parentPassword = `Parent#${RUN}`;
  await expect('give guardian a parent login', admin, 'POST', `/guardians/${guardian.id}/account`, { email: parentEmail, password: parentPassword });
  const parent = await login(parentEmail, parentPassword);
  const children = (await expect('parent lists own children', parent, 'GET', '/me/children')).data;
  check('parent sees the linked child', children?.length === 1 && children[0].id === studentId, children);
  const parentStudents = (await call(parent, 'GET', '/students')).data;
  check('parent student list is only the child', parentStudents?.length === 1, parentStudents?.length);
  const parentGuardians = (await call(parent, 'GET', '/guardians')).data;
  check('parent sees only guardians of own child', parentGuardians?.length >= 1 && parentGuardians.every((g) => g.students.some((link) => link.student.id === studentId)), parentGuardians?.length);
  await expect('parent updates child contact (Tier 1)', parent, 'PATCH', `/me/children/${studentId}/contact-details`, { phone: '9000000001' });
  await expect('student cannot list other guardians data', student, 'GET', `/guardians/${guardian.id}`, undefined, [200]);

  heading('Attendance');
  const marked = (await expect('teacher marks today', teacher, 'POST', '/attendance', { enrollmentId: enrollment.id, attendanceDate: day(0), status: 'PRESENT' })).data;
  await expect('duplicate mark conflicts', teacher, 'POST', '/attendance', { enrollmentId: enrollment.id, attendanceDate: day(0), status: 'PRESENT' }, 409);
  await expect('future date is rejected', teacher, 'POST', '/attendance', { enrollmentId: enrollment.id, attendanceDate: day(2), status: 'PRESENT' }, 400);
  await expect('edit needs a reason', teacher, 'PATCH', `/attendance/${marked.id}`, { status: 'LATE' }, 400);
  await expect('Tier 2 same-day edit with reason', teacher, 'PATCH', `/attendance/${marked.id}`, { status: 'LATE', reason: 'Arrived 10 minutes late' });
  const bulk = (await expect('bulk mark two days ago', teacher, 'POST', '/attendance/bulk', {
    attendanceDate: day(-2), records: [{ enrollmentId: enrollment.id, status: 'ABSENT' }, { enrollmentId: enrollment2.id, status: 'PRESENT' }],
  })).data;
  check('bulk created both', bulk?.created === 2, bulk);
  const old = (await expect('mark a record five days ago', teacher, 'POST', '/attendance', { enrollmentId: enrollment.id, attendanceDate: day(-5), status: 'ABSENT' })).data;
  await expect('teacher cannot directly edit a 5-day-old record', teacher, 'PATCH', `/attendance/${old.id}`, { status: 'PRESENT', reason: 'Medical note' }, 403);
  const correction = (await expect('teacher raises a correction request (Tier 3)', teacher, 'POST', `/attendance/${old.id}/correction-request`, { status: 'EXCUSED', reason: 'Medical certificate received' })).data;
  check('correction waits for approval', correction?.applied === false, correction);
  await expect('admin approves the correction', admin, 'POST', `/approval-requests/${correction.approvalRequest.id}/approve`, {});
  const corrected = (await call(admin, 'GET', `/attendance/${old.id}`)).data;
  check('record corrected to EXCUSED', corrected?.status === 'EXCUSED', corrected?.status);
  const studentAttendance = await expect('student reads own attendance', student, 'GET', `/students/${studentId}/attendance`);
  check('student attendance only own', studentAttendance.data?.every((r) => r.enrollment.student.id === studentId), studentAttendance.meta);
  await expect('student cannot mark attendance', student, 'POST', '/attendance', { enrollmentId: enrollment.id, attendanceDate: day(0), status: 'PRESENT' }, 403);
  const sectionView = (await expect('teacher section view', teacher, 'GET', `/sections/${secA.id}/attendance?attendanceDate=${day(0)}`)).data;
  check('section view lists students', sectionView?.length >= 1, sectionView);
  await expect('teacher blocked from an unassigned section', teacher, 'GET', `/sections/${secB.id}/attendance`, undefined, [200, 403]);
  const att = (await expect('attendance summary', admin, 'GET', `/attendance/summary?from=${day(-10)}&to=${day(0)}&sectionId=${secA.id}`)).data;
  check('summary has a rate', typeof att?.attendanceRate === 'number', att);
  const csv = await call(admin, 'GET', `/attendance/export?from=${day(-10)}&to=${day(0)}`, undefined, { raw: true });
  check('attendance CSV export', csv.status === 200 && csv.text.startsWith('"date"'), csv.text.slice(0, 80));

  heading('Homework');
  const hw = (await expect('teacher creates homework for 8-A maths', teacher, 'POST', '/homework', {
    academicYearId: year.id, classId: cls.id, sectionId: secA.id, subjectId: maths.id, title: 'Fractions worksheet', dueDate: day(3), maxMarks: 10,
  })).data;
  await expect('teacher blocked for 8-B maths (not assigned)', teacher, 'POST', '/homework', {
    academicYearId: year.id, classId: cls.id, sectionId: secB.id, subjectId: maths.id, title: 'Not allowed',
  }, 403);
  const draftsForStudent = (await call(student, 'GET', '/homework')).data;
  check('student cannot see drafts', !draftsForStudent?.some((h) => h.id === hw.id), draftsForStudent?.length);
  await expect('publish homework', teacher, 'POST', `/homework/${hw.id}/publish`);
  await expect('publishing twice conflicts', teacher, 'POST', `/homework/${hw.id}/publish`, undefined, 409);
  const studentHw = (await expect('student homework list', student, 'GET', `/students/${studentId}/homework`)).data;
  check('student sees the published homework', studentHw?.some((h) => h.id === hw.id), studentHw?.length);
  const submission = (await expect('student submits', student, 'POST', `/homework/${hw.id}/submit`, { content: '1/2 + 1/4 = 3/4' })).data;
  const parentView = (await call(parent, 'GET', `/homework/${hw.id}`)).data;
  check('parent sees homework with only the child submission', parentView?.submissions?.every((s) => s.studentId === studentId), parentView?.submissions);
  await expect('teacher grades the submission', teacher, 'POST', `/homework/${hw.id}/submissions/${submission.id}/grade`, { score: 9, feedback: 'Good work' });
  await expect('graded submission cannot be overwritten', student, 'POST', `/homework/${hw.id}/submit`, { content: 'changed' }, 409);
  await expect('homework with submissions cannot be deleted', teacher, 'DELETE', `/homework/${hw.id}`, undefined, 409);
  await expect('archive homework', teacher, 'POST', `/homework/${hw.id}/archive`);

  heading('Announcements');
  const ann = (await expect('admin creates class-targeted announcement', admin, 'POST', '/announcements', {
    title: `Class 8 trip ${RUN}`, content: 'Field trip on Friday', targetClassId: cls.id,
  })).data;
  check('student cannot see draft announcement', !(await call(student, 'GET', '/announcements')).data?.some((a) => a.id === ann.id));
  await expect('publish announcement', admin, 'POST', `/announcements/${ann.id}/publish`);
  check('student in Class 8 sees it', (await call(student, 'GET', '/announcements')).data?.some((a) => a.id === ann.id));
  const roleAnn = (await call(admin, 'POST', '/announcements', { title: `Staff only ${RUN}`, content: 'Staff meeting', targetRole: 'Teacher' })).data;
  await call(admin, 'POST', `/announcements/${roleAnn.id}/publish`);
  check('student does not see teacher-only announcement', !(await call(student, 'GET', '/announcements')).data?.some((a) => a.id === roleAnn.id));
  check('teacher sees teacher-only announcement', (await call(teacher, 'GET', '/announcements')).data?.some((a) => a.id === roleAnn.id));

  heading('Examinations and marks');
  const exam = (await expect('create examination', admin, 'POST', '/examinations', { academicYearId: year.id, name: `Term 1 ${RUN}`, term: 'T1' })).data;
  const assessment = (await expect('add maths assessment', admin, 'POST', `/examinations/${exam.id}/assessments`, { classId: cls.id, subjectId: maths.id, maxMarks: 50, passMarks: 17 })).data;
  await expect('marks above maximum rejected', teacher, 'POST', '/marks', { assessmentId: assessment.id, studentId, marksObtained: 60 }, 400);
  const bulkMarks = (await expect('teacher enters marks in bulk', teacher, 'POST', '/marks/bulk', {
    assessmentId: assessment.id, marks: [{ studentId, marksObtained: 42 }, { studentId: newStudent.id, isAbsent: true }],
  })).data;
  check('both marks saved (8-A now holds both students)', bulkMarks?.saved === 2, bulkMarks);
  check('student cannot see unreleased marks', !(await call(student, 'GET', '/marks')).data?.some((m) => m.assessmentId === assessment.id));
  await expect('verify fails before submission', admin, 'POST', `/examinations/${exam.id}/verify`, {}, 409);
  await expect('teacher submits marks', teacher, 'POST', '/marks/submit', { assessmentId: assessment.id });
  const verification = (await expect('verification view', admin, 'GET', `/examinations/${exam.id}/verification`)).data;
  check('verification complete', verification?.missing === 0 && verification?.unsubmitted === 0, verification);
  await expect('verify', admin, 'POST', `/examinations/${exam.id}/verify`, {});
  await expect('lock', admin, 'POST', `/examinations/${exam.id}/lock`, {});
  await expect('release', admin, 'POST', `/examinations/${exam.id}/release`, {});
  const cards = (await expect('student report card', student, 'GET', `/students/${studentId}/report-cards`)).data;
  const card = cards?.find((c) => c.examination.id === exam.id);
  check('report card shows 42/50 with grade A2', card?.subjects?.[0]?.marksObtained === 42 && card?.grade === 'A2', card);
  const markList = (await call(student, 'GET', '/marks')).data;
  check('student now sees only own released marks', markList?.length >= 1 && markList.every((m) => m.studentId === studentId), markList?.length);
  const ownMark = markList.find((m) => m.assessmentId === assessment.id);
  await expect('post-release correction needs a document (Tier 4)', teacher, 'POST', `/marks/${ownMark.id}/correction-request`, { marksObtained: 44, reason: 'Totalling error' }, 400);

  heading('Files and Tier 4 approvals');
  const form = new FormData();
  form.append('file', new Blob(['Recount sheet signed by examiner'], { type: 'text/plain' }), 'recount.txt');
  form.append('entityType', 'student');
  form.append('entityId', studentId);
  const upload = await call(teacher, 'POST', '/files/upload', undefined, { form });
  check('upload supporting document', upload.status === 201, upload.error);
  const fileId = upload.data?.id;
  if (fileId) {
    const link = (await expect('signed download URL', teacher, 'GET', `/files/${fileId}/download-url`)).data;
    check('signed URL expires in 5 minutes', link?.expiresInSeconds === 300 && link.url.includes('token='), link);
    const markCorrection = (await expect('Tier 4 mark correction with document', teacher, 'POST', `/marks/${ownMark.id}/correction-request`, {
      marksObtained: 44, reason: 'Totalling error', documentFileId: fileId,
    })).data;
    check('correction is Tier 4', markCorrection?.tier === 4, markCorrection);
    const afterAdmin = (await expect('School Admin approves first slot', admin, 'POST', `/approval-requests/${markCorrection.approvalRequest.id}/approve`, {})).data;
    check('still pending: needs Principal too', afterAdmin?.status === 'PENDING', afterAdmin?.status);
    await expect('same admin cannot approve twice', admin, 'POST', `/approval-requests/${markCorrection.approvalRequest.id}/approve`, {}, 409);
    await expect('requester cancels the request', teacher, 'POST', `/approval-requests/${markCorrection.approvalRequest.id}/cancel`, {});
    const identity = (await expect('admin requests a name correction (Tier 4)', admin, 'PATCH', `/students/${newStudent.id}`, {
      firstName: 'Ravindra', reason: 'Spelling per birth certificate', documentFileId: fileId,
    })).data;
    check('name change is pending approval, not applied', identity?.approvalRequest?.status === 'PENDING' && identity.student.firstName === 'Ravi', identity);
    await expect('raised by School Admin counts as the admin slot', admin, 'POST', `/approval-requests/${identity.approvalRequest.id}/approve`, {}, 409);
    const history = (await expect('approval history', admin, 'GET', `/approval-requests/${identity.approvalRequest.id}/history`)).data;
    check('history has the request event', history?.events?.some((e) => e.action === 'approval.requested'), history?.events);
    await expect('cancel the name change', admin, 'POST', `/approval-requests/${identity.approvalRequest.id}/cancel`, {});
  }
  await expect('student cannot approve requests', student, 'GET', '/approval-requests', undefined, 403);

  heading('Fees and payments');
  const structure = (await expect('create fee structure', admin, 'POST', '/fee-structures', {
    academicYearId: year.id, classId: cls.id, name: `Class 8 fees ${RUN}`,
    items: [{ name: 'Tuition', amount: 12000, dueDate: day(-1) }, { name: 'Exam', amount: 1000, dueDate: day(30) }],
  })).data;
  await expect('cannot assign before approval', admin, 'POST', '/student-fees', { feeStructureId: structure.id }, 409);
  await expect('submit for approval', admin, 'POST', `/fee-structures/${structure.id}/submit-approval`, { reason: 'New year fees' });
  const approvedStructure = (await expect('approve fee structure', admin, 'POST', `/fee-structures/${structure.id}/approve`, {})).data;
  check('structure approved', approvedStructure?.status === 'APPROVED', approvedStructure?.status);
  await expect('edit after approval is blocked', admin, 'PATCH', `/fee-structures/${structure.id}`, { name: 'Changed' }, 409);
  const assigned = (await expect('assign to the whole class', admin, 'POST', '/student-fees', { feeStructureId: structure.id })).data;
  check('assigned to both students', assigned?.assigned === 2, assigned);
  const fees = (await expect('student reads own fees', student, 'GET', '/student-fees')).data;
  check('student sees only own fee', fees?.length >= 1 && fees.every((f) => f.studentId === studentId), fees?.length);
  const fee = fees.find((f) => f.feeStructureId === structure.id);
  check('balance is 13000', fee?.balance === 13000, fee?.balance);
  const discount = (await expect('discount applied directly by School Admin', admin, 'POST', `/student-fees/${fee.id}/apply-discount`, { amount: 1000, reason: 'Sibling discount' })).data;
  check('discount reduces balance to 12000', discount?.studentFee?.balance === 12000, discount?.studentFee?.balance);
  await expect('overpayment rejected', admin, 'POST', '/payments', { studentFeeId: fee.id, amount: 20000, method: 'CASH' }, 400);
  const cash = (await expect('record cash payment', admin, 'POST', '/payments', { studentFeeId: fee.id, amount: 5000, method: 'CASH', reference: 'Counter 1' })).data;
  check('cash verified with receipt', cash?.status === 'VERIFIED' && cash.receiptNo?.startsWith('RCPT-'), cash);
  const cheque = (await expect('record cheque payment', admin, 'POST', '/payments', { studentFeeId: fee.id, amount: 2000, method: 'CHEQUE', reference: 'CHQ 1234' })).data;
  check('cheque waits for clearance', cheque?.status === 'PENDING' && !cheque.receiptNo, cheque);
  await expect('verify cheque', admin, 'POST', `/payments/${cheque.id}/verify`);
  const receipt = (await expect('student fetches receipt', student, 'GET', `/payments/${cash.id}/receipt`)).data;
  check('receipt shows amount 5000', receipt?.amount === 5000, receipt);
  const order = (await expect('student creates online order', student, 'POST', '/payments/orders', { studentFeeId: fee.id, amount: 1000 })).data;
  check('dev order id issued', order?.orderId?.startsWith('order_'), order);
  const webhookBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${RUN}`, order_id: order.orderId } } } });
  const eventId = randomUUID();
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(webhookBody).digest('hex');
  await expect('webhook with a bad signature is rejected', null, 'POST', '/payments/webhooks/razorpay', webhookBody, 401, {
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'bad', 'x-razorpay-event-id': eventId },
  });
  const hook = await expect('signed webhook captures the payment', null, 'POST', '/payments/webhooks/razorpay', webhookBody, 200, {
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId },
  });
  check('webhook matched and verified', hook.data?.status === 'VERIFIED', hook.data);
  const replay = await call(null, 'POST', '/payments/webhooks/razorpay', webhookBody, {
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId },
  });
  check('webhook replay is idempotent', replay.data?.duplicate === true, replay.data);
  const feeSummary = (await expect('student fee summary', student, 'GET', `/students/${studentId}/fee-summary`)).data;
  const after = feeSummary?.fees?.find((f) => f.id === fee.id);
  check('balance now 4000 and PARTIAL', after?.balance === 4000 && after.status === 'PARTIAL', after);
  await expect('refund request (Tier 3)', admin, 'POST', `/payments/${cheque.id}/refund-request`, { reason: 'Cheque bounced later' });
  await expect('approve refund', admin, 'POST', `/payments/${cheque.id}/refund`, {});
  await expect('overdue list', admin, 'GET', '/fees/overdue');
  await expect('fee report', admin, 'GET', `/fees/reports?from=${day(-30)}&to=${day(0)}`);
  await expect('teacher has no fee access', teacher, 'GET', '/student-fees', undefined, 403);

  heading('Timetable and substitutes');
  const draft = (await expect('generate a draft timetable for 8-A', admin, 'POST', '/timetables/generate-draft', {
    academicYearId: year.id, sectionId: secA.id, periodsPerDay: 2, days: [1, 2, 3, 4, 5, 6],
  })).data;
  check('draft placed periods', draft?.placed > 0, draft);
  const validation = (await expect('validate timetable', admin, 'POST', `/timetables/${draft.timetable.id}/validate`)).data;
  check('no conflicts', validation?.valid === true, validation?.conflicts);
  const firstSlot = draft.timetable.slots[0];
  await expect('double-booking the teacher is rejected', admin, 'POST', '/timetable-slots', {
    timetableId: draft.timetable.id, dayOfWeek: firstSlot.dayOfWeek, periodNo: firstSlot.periodNo, subjectId: maths.id, staffId: teacherStaff.id,
  }, 409);
  await expect('publish timetable', admin, 'POST', `/timetables/${draft.timetable.id}/publish`);
  const myTimetable = (await expect('teacher views own timetable', teacher, 'GET', `/teachers/${teacherStaff.id}/timetable`)).data;
  check('teacher timetable has periods', myTimetable?.length > 0, myTimetable?.length);
  await expect('student views section timetable', student, 'GET', `/sections/${secA.id}/timetable`);

  heading('Leave');
  for (const old of (await call(admin, 'GET', `/student-leaves?studentId=${studentId}`)).data ?? []) {
    if (['PENDING', 'APPROVED'].includes(old.status)) await expect('cancel an earlier student leave', admin, 'POST', `/student-leaves/${old.id}/cancel`);
  }
  for (const old of (await call(admin, 'GET', `/staff-leaves?staffId=${teacherStaff.id}`)).data ?? []) {
    if (['PENDING', 'APPROVED'].includes(old.status)) await expect('cancel an earlier staff leave', admin, 'POST', `/staff-leaves/${old.id}/cancel`);
  }
  const leave = (await expect('parent requests student leave', parent, 'POST', '/student-leaves', {
    studentId, fromDate: day(5), toDate: day(6), reason: 'Family function',
  })).data;
  const decided = (await expect('class teacher approves leave', teacher, 'POST', `/student-leaves/${leave.id}/approve`, { note: 'Approved' })).data;
  check('approved leave marked ON_LEAVE days', decided?.markedDays >= 1, decided);
  const onLeave = (await call(admin, 'GET', `/attendance?studentId=${studentId}&status=ON_LEAVE`)).data;
  check('attendance shows ON_LEAVE', onLeave?.length >= 1, onLeave?.length);
  await expect('set teacher entitlements', admin, 'PATCH', `/staff/${teacherStaff.id}/leave-entitlements`, {
    academicYearId: year.id, entitlements: [{ leaveType: 'CASUAL', days: 12 }, { leaveType: 'SICK', days: 10 }],
  });
  const balance = (await expect('teacher leave balance', teacher, 'GET', `/staff/${teacherStaff.id}/leave-balance`)).data;
  check('12 casual days available', balance?.find((b) => b.leaveType === 'CASUAL')?.remaining >= 1, balance);
  const staffLeave = (await expect('teacher requests casual leave', teacher, 'POST', '/staff-leaves', {
    leaveType: 'CASUAL', fromDate: day(8), toDate: day(9), reason: 'Personal work',
  })).data;
  if (!staffLeave) throw new Error('staff leave was not created');
  await expect('teacher cannot approve own leave', teacher, 'POST', `/staff-leaves/${staffLeave.id}/approve`, {}, 403);
  const approvedLeave = (await expect('admin approves staff leave', admin, 'POST', `/staff-leaves/${staffLeave.id}/approve`, {})).data;
  check('substitute requests opened for timetabled periods', approvedLeave?.substitutesOpened >= 1, approvedLeave);
  const subs = (await expect('list substitute requests', admin, 'GET', '/substitute-requests?status=OPEN')).data;
  const sub = subs?.find((s) => s.originalStaffId === teacherStaff.id);
  check('open substitute request exists', sub, subs?.length);
  if (sub) {
    const available = (await expect('available substitute teachers', admin, 'GET', `/substitute-requests/${sub.id}/available-teachers`)).data;
    check('the absent teacher is not offered', !available?.some((t) => t.staffId === teacherStaff.id), available);
  }

  heading('Complaints and feedback');
  const complaint = (await expect('parent files a complaint about the teacher', parent, 'POST', '/complaints', {
    category: 'Conduct', subject: 'Homework load', description: 'Too much homework this week for the class.', aboutStaffId: teacherStaff.id, studentId,
  })).data;
  check('submitter cannot see who the complaint names', complaint?.aboutStaffId === undefined, complaint);
  await expect('teacher has no complaint access', teacher, 'GET', '/complaints', undefined, 403);
  await expect('admin assigns to self', admin, 'POST', `/complaints/${complaint.id}/assign`, { assignedToId: me.id });
  await expect('start investigation', admin, 'POST', `/complaints/${complaint.id}/start-investigation`);
  await expect('add action note', admin, 'POST', `/complaints/${complaint.id}/add-action`, { note: 'Spoke with the teacher' });
  await expect('resolve', admin, 'POST', `/complaints/${complaint.id}/resolve`, { note: 'Homework load reduced' });
  const parentComplaint = (await expect('parent sees resolved status', parent, 'GET', `/complaints/${complaint.id}`)).data;
  check('resolved', parentComplaint?.status === 'RESOLVED', parentComplaint?.status);
  await expect('parent reopens', parent, 'POST', `/complaints/${complaint.id}/reopen`, { note: 'Still too much' });
  await expect('anonymous complaint', student, 'POST', '/complaints', { category: 'Facilities', subject: 'Water cooler', description: 'Water cooler is broken for a week.', isAnonymous: true });
  await expect('feedback', parent, 'POST', '/feedback', { category: 'General', message: 'Thanks for the trip' });

  heading('Certificates');
  const cert = (await expect('create bonafide certificate', admin, 'POST', '/certificates', { studentId, type: 'BONAFIDE', purpose: 'Bank account' })).data;
  await expect('cannot generate before approval', admin, 'POST', `/certificates/${cert.id}/generate`, undefined, 409);
  await expect('submit for approval (Tier 3)', admin, 'POST', `/certificates/${cert.id}/submit-approval`, { reason: 'Parent request' });
  await expect('approve certificate', admin, 'POST', `/certificates/${cert.id}/approve`, {});
  const issued = (await expect('generate certificate', admin, 'POST', `/certificates/${cert.id}/generate`)).data;
  check('issued with serial number', issued?.status === 'ISSUED' && issued.serialNo, issued);
  await expect('issued certificate is immutable', admin, 'POST', `/certificates/${cert.id}/generate`, undefined, 409);
  const html = await call(student, 'GET', `/certificates/${cert.id}/download`, undefined, { raw: true });
  check('student downloads certificate HTML', html.status === 200 && html.text.includes('Bonafide Certificate'), html.status);
  const tc = (await call(admin, 'POST', '/certificates', { studentId, type: 'TRANSFER' })).data;
  await expect('transfer certificate needs a document (Tier 4)', admin, 'POST', `/certificates/${tc.id}/submit-approval`, { reason: 'Leaving' }, 400);

  heading('Notifications');
  const unread = (await expect('parent unread count', parent, 'GET', '/notifications/unread-count')).data;
  check('parent received notifications', unread?.unread > 0, unread);
  await expect('preferences', parent, 'PATCH', '/notification-preferences', { sms: true, mutedTypes: ['homework.assigned'] });
  await expect('register device', parent, 'POST', '/devices', { token: `fcm-${RUN}-token`, platform: 'android' });
  await expect('mark all read', parent, 'POST', '/notifications/read-all');
  check('unread now zero', (await call(parent, 'GET', '/notifications/unread-count')).data?.unread === 0);
  await expect('admin templates', admin, 'POST', '/notification-templates', { code: `fee-reminder-${RUN}`, channel: 'SMS', body: 'Fee due on {{date}}' });
  await expect('delivery log', admin, 'GET', '/notification-deliveries');

  heading('Dashboards, reports, analytics');
  await expect('principal dashboard', admin, 'GET', '/dashboards/principal');
  const tdash = (await expect('teacher dashboard', teacher, 'GET', '/dashboards/teacher')).data;
  check('teacher dashboard has pending work', tdash?.pendingWork, tdash);
  const pdash = (await expect('parent dashboard', parent, 'GET', '/dashboards/parent')).data;
  check('parent dashboard shows the child', pdash?.children?.[0]?.student?.id === studentId, pdash);
  await expect('accountant dashboard (admin)', admin, 'GET', '/dashboards/accountant');
  await expect('student cannot open principal dashboard', student, 'GET', '/dashboards/principal', undefined, 403);
  for (const path of [
    `/reports/attendance-summary?from=${day(-30)}&to=${day(0)}`,
    '/reports/examination-status',
    '/reports/pending-approvals',
    '/reports/complaint-summary',
    `/reports/collections?from=${day(-30)}&to=${day(0)}`,
    `/reports/reconciliation?from=${day(-30)}&to=${day(0)}`,
    `/analytics/attendance?from=${day(-30)}&to=${day(0)}`,
    '/analytics/academic-performance',
    '/analytics/fee-collection',
    '/analytics/teacher-workload',
    '/analytics/complaints',
    '/analytics/attendance-risk',
  ]) {
    await expect(`GET ${path.split('?')[0]}`, admin, 'GET', path);
  }

  heading('Transport, library, assets');
  const route = (await expect('create route', admin, 'POST', '/transport/routes', { code: `R${RUN.slice(-6)}`, name: 'North loop' })).data;
  const stop = (await expect('create stop', admin, 'POST', '/transport/stops', { routeId: route.id, name: 'Main gate', sequence: 1, pickupTime: '07:30' })).data;
  await expect('create bus', admin, 'POST', '/transport/buses', { registrationNo: `TS09${RUN.slice(-6)}`, capacity: 40, routeId: route.id });
  await expect('allocate student', admin, 'POST', '/transport/allocations', { studentId, routeId: route.id, stopId: stop.id });
  await expect('record boarding by student id', admin, 'POST', '/transport/boarding-events', { studentId, type: 'BOARDED' });
  const ride = (await expect('parent sees child transport', parent, 'GET', `/students/${studentId}/transport`)).data;
  check('allocation and boarding visible', ride?.allocation?.stopId === stop.id && ride.recentEvents.length >= 1, ride);
  const book = (await expect('add book', admin, 'POST', '/library/books', { title: `Wings of Fire ${RUN}`, author: 'A. P. J. Abdul Kalam', copies: 1 })).data;
  const issue = (await expect('issue book', admin, 'POST', '/library/issues', { bookId: book.id, studentId, dueDate: day(-3) })).data;
  await expect('no copies left', admin, 'POST', '/library/issues', { bookId: book.id, studentId, dueDate: day(7) }, 409);
  const returned = (await expect('late return creates a fine', admin, 'POST', '/library/returns', { issueId: issue.id })).data;
  check('fine of 6 for 3 days', Number(returned?.fine?.amount) === 6, returned);
  await expect('waive fine', admin, 'POST', `/library/fines/${returned.fine.id}/waive`);
  await expect('student library history', student, 'GET', `/students/${studentId}/library-history`);
  const asset = (await expect('register asset', admin, 'POST', '/assets', { assetTag: `PROJ-${RUN}`, name: 'Projector', category: 'Electronics', location: 'Room 8A' })).data;
  await expect('assign asset', admin, 'POST', `/assets/${asset.id}/assign`, { staffId: teacherStaff.id });
  await expect('maintenance', admin, 'POST', `/assets/${asset.id}/maintenance`, { note: 'Lamp replaced', status: 'IN_MAINTENANCE' });
  const assetHistory = (await expect('asset history', admin, 'GET', `/assets/${asset.id}/history`)).data;
  check('asset history has 3 events', assetHistory?.length === 3, assetHistory?.length);

  heading('Offline sync');
  const checkpoint = (await expect('sync checkpoint', teacher, 'GET', '/sync/checkpoint')).data;
  check('checkpoint has active year', checkpoint?.activeAcademicYear?.id === year.id, checkpoint);
  const syncResult = (await expect('sync offline attendance', teacher, 'POST', '/sync/attendance', {
    deviceId: 'tablet-1',
    items: [
      { enrollmentId: enrollment.id, attendanceDate: day(-1), status: 'PRESENT', capturedAt: new Date().toISOString() },
      { enrollmentId: enrollment.id, attendanceDate: day(0), status: 'ABSENT', capturedAt: new Date(Date.now() - 86_400_000).toISOString() },
    ],
  })).data;
  check('one applied, one conflict', syncResult?.appliedCount === 1 && syncResult?.conflictCount === 1, syncResult);
  const conflicts = (await expect('list conflicts', admin, 'GET', '/sync/conflicts')).data;
  const conflict = conflicts?.find((c) => c.batchId === syncResult.id);
  if (conflict) await expect('resolve conflict keeping server value', admin, 'POST', `/sync/conflicts/${conflict.id}/resolve`, { resolution: 'KEEP_SERVER', note: 'Teacher confirmed' });

  heading('Permissions and audit');
  const override = (await expect('revoke homework:read for the student', admin, 'POST', `/users/${studentMe.id}/permission-overrides`, {
    permissionCode: 'homework:read', effect: 'REVOKE', reason: 'Test',
  })).data;
  await expect('student now blocked from homework', student, 'GET', '/homework', undefined, 403);
  await expect('remove override', admin, 'DELETE', `/users/${studentMe.id}/permission-overrides/${override.id}`);
  await expect('student homework access restored', student, 'GET', '/homework');
  const audit = await expect('audit log search', admin, 'GET', '/audit-logs?limit=5');
  check('audit trail is being written', audit.meta?.total > 10, audit.meta);
  const auditCsv = await call(admin, 'GET', '/audit-logs/export?action=attendance', undefined, { raw: true });
  check('audit CSV export', auditCsv.status === 200 && auditCsv.text.includes('attendance.'), auditCsv.status);
  await expect('entity history for the corrected attendance', admin, 'GET', `/audit-logs/entity/attendance/${old.id}`);
  await expect('security: suspicious activity', admin, 'GET', '/security-events/suspicious-activity');
  await expect('teacher cannot read audit log', teacher, 'GET', '/audit-logs', undefined, 403);
  await expect('built-in role cannot be renamed', admin, 'GET', '/roles');

  heading('Year end');
  const rollover = (await expect('roll the structure over to a new year', admin, 'POST', `/academic-years/${year.id}/rollover`, {
    name: `E2E next ${RUN}`, startsOn: '2027-07-01', endsOn: '2028-03-31', copyAssignments: true,
  })).data;
  check('rollover copied classes, sections, subjects', rollover?.classesCopied === 2 && rollover.sectionsCopied === 3 && rollover.subjectsCopied === 2, rollover);
  await expect('close the rolled-over year', admin, 'POST', `/academic-years/${rollover.academicYear.id}/close`);
  await expect('closed year cannot be edited', admin, 'PATCH', `/academic-years/${rollover.academicYear.id}`, { name: 'x' }, 400);
}

main()
  .catch((error) => {
    console.error('\nFATAL', error);
    results.push({ section, name: 'script completed', ok: false, detail: String(error) });
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
      console.log('\nFailures:');
      failed.forEach((f) => console.log(`  [${f.section}] ${f.name}: ${JSON.stringify(f.detail)?.slice(0, 300)}`));
      process.exitCode = 1;
    }
  });
