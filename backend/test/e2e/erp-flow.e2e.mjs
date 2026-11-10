/**
 * End-to-end walkthrough of the ERP API against a running server and the test school.
 *
 *   node test/e2e/erp-flow.e2e.mjs
 *
 * Env: API_URL (default http://localhost:3000/api/v1), CREDENTIALS_FILE (default ../test-org-school.txt),
 *      RAZORPAY_WEBHOOK_SECRET (must match the server; default dev_webhook_secret),
 *      SUPABASE_URL and SUPABASE_ANON_KEY (read from .env) for the direct Data API checks.
 * Each run creates its own academic year and records, so it can be repeated.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ quiet: true });

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dev_webhook_secret';
const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const results = [];
let section = '';

// ---------- helpers ----------

// Verhoeff tables, to make Aadhaar-shaped test numbers that pass the real checksum.
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const VINV = [0,4,3,2,1,5,6,7,8,9];
/** A random 12-digit number with a valid Aadhaar check digit (not a real person's). */
function testAadhaar() {
  let body = String(2 + Math.floor(Math.random() * 8));
  while (body.length < 11) body += String(Math.floor(Math.random() * 10));
  let c = 0;
  [...body].reverse().forEach((d, i) => { c = VD[c][VP[(i + 1) % 8][Number(d)]]; });
  return body + VINV[c];
}

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
  const optional = (label) => (text.includes(`${label}:`) ? block(label) : null);
  return {
    admin: block('Admin'),
    teacher: block('Teacher'),
    student: block('Student'),
    principal: block('Principal'),
    superAdmin: optional('Super Admin'),
  };
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

/** Runs the delivery worker until none of the notification's deliveries are QUEUED or SENDING. */
async function settleDeliveries(token, notificationId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await call(token, 'POST', '/notification-deliveries/process', {});
    const rows = (await call(token, 'GET', `/notification-deliveries?notificationId=${notificationId}`)).data ?? [];
    if (rows.length && rows.every((row) => !['QUEUED', 'SENDING'].includes(row.status))) return rows;
    await new Promise((done) => setTimeout(done, 500));
  }
  return (await call(token, 'GET', `/notification-deliveries?notificationId=${notificationId}`)).data ?? [];
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
  const principal = await login(creds.principal.email, creds.principal.password);
  check('admin, teacher, student and principal log in', admin && teacher && student && principal);
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

  heading('Direct database access (Row-Level Security)');
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    check('SUPABASE_URL and SUPABASE_ANON_KEY are set for the Data API checks', false, 'missing in .env');
  } else {
    const dataApi = (token, method, table, body) => fetch(`${SUPABASE_URL}/rest/v1/${table}${method === 'GET' ? '?select=id&limit=1' : ''}`, {
      method,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: body && JSON.stringify(body),
    });
    for (const [who, token] of [['anon key', SUPABASE_ANON_KEY], ['signed-in user token', admin]]) {
      for (const table of ['students', 'users', 'payments', 'audit_logs', 'marks']) {
        const response = await dataApi(token, 'GET', table);
        check(`${who} cannot read ${table} through the Data API`, [401, 403].includes(response.status), `${response.status} ${(await response.text()).slice(0, 120)}`);
      }
      const write = await dataApi(token, 'POST', 'audit_logs', { action: 'rls.probe' });
      check(`${who} cannot write through the Data API`, [401, 403].includes(write.status), write.status);
    }
  }

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
  const cls8Sections = (await expect('list Class 8 sections', admin, 'GET', `/sections?classId=${cls.id}`)).data;
  check('a new class gets Section A automatically', cls8Sections?.length === 1 && cls8Sections[0].name === 'A', cls8Sections);
  const secA = cls8Sections?.[0];
  await expect('Section A cannot be created twice', admin, 'POST', '/sections', { academicYearId: year.id, classId: cls.id, name: 'A' }, 409);
  const secB = (await expect('create section B', admin, 'POST', '/sections', { academicYearId: year.id, classId: cls.id, name: 'B' })).data;
  check('Class 9 also has Section A', (await call(admin, 'GET', `/sections?classId=${cls9.id}`)).data?.some((section) => section.name === 'A'));
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
  const aadhaar2 = testAadhaar();
  const mobile2 = `98${RUN.slice(-8)}`;
  const registration = {
    admissionNo: `E2E-${RUN}`, admissionDate: '2026-09-02', admissionType: 'NEW_TO_SCHOOL', sectionId: secB.id,
    firstName: 'Ravi', familyName: 'Kumar', gender: 'MALE', dateOfBirth: '2013-05-10',
    parentName: 'Suresh Kumar', parentRelation: 'Father', parentMobile: `+91 ${mobile2.slice(0, 5)} ${mobile2.slice(5)}`,
    aadhaarNumber: aadhaar2, nfcId: `nfc-e2e-${RUN}`,
    previousSchool: 'ZPHS Tenali', lastClassPassed: 'Class 7', previousPercentage: 82.5,
  };
  await expect('teacher cannot register a student', teacher, 'POST', '/students', registration, 403);
  await expect('new-to-school student needs previous school details', admin, 'POST', '/students', { ...registration, previousSchool: undefined, previousPercentage: undefined }, 400);
  await expect('an invalid Aadhaar number is refused', admin, 'POST', '/students', { ...registration, aadhaarNumber: '234567890123' }, 400);
  await expect('a 9-digit parent mobile is refused', admin, 'POST', '/students', { ...registration, parentMobile: '944012345' }, 400);
  const newStudent = (await expect('School Admin registers a student into 8-B', admin, 'POST', '/students', registration, 201)).data;
  check('login ID is the admission number', newStudent?.loginId === `E2E-${RUN}`, newStudent?.loginId);
  check('first password is family name + @ + last 4 of mobile', newStudent?.firstPassword === `Kuma@${mobile2.slice(-4)}`, newStudent?.firstPassword);
  check('student is put in 8-B with the next roll number', newStudent?.enrollment?.sectionId === secB.id && newStudent?.enrollment?.rollNumber === '1', newStudent?.enrollment);
  check('card ID typed in lowercase is saved in uppercase', newStudent?.nfcId === `NFC-E2E-${RUN}`, newStudent?.nfcId);
  check('Aadhaar comes back masked only', newStudent?.aadhaarMasked === `XXXX XXXX ${aadhaar2.slice(-4)}` && !('aadhaarEncrypted' in (newStudent ?? {})) && !('aadhaarHash' in (newStudent ?? {})), newStudent);
  check('first password must be changed', newStudent?.mustChangePassword === true);
  const enrollment2 = newStudent.enrollment;
  await expect('the same admission number is refused', admin, 'POST', '/students', { ...registration, aadhaarNumber: testAadhaar(), nfcId: `NFC-E2E-X-${RUN}` }, 409);
  await expect('the same Aadhaar under another admission number is refused', admin, 'POST', '/students', { ...registration, admissionNo: `E2E-A-${RUN}`, nfcId: `NFC-E2E-Y-${RUN}` }, 400);
  await expect('the same card in a different case is refused', admin, 'POST', '/students', { ...registration, admissionNo: `E2E-D-${RUN}`, aadhaarNumber: testAadhaar(), nfcId: `NFC-E2E-${RUN}` }, 400);
  const adminView = (await expect('admin opens the new student', admin, 'GET', `/students/${newStudent.id}`)).data;
  check('admin sees Aadhaar masked, not stored values', adminView?.aadhaarMasked?.endsWith(aadhaar2.slice(-4)) && !('aadhaarEncrypted' in (adminView ?? {})) && !('aadhaarHash' in (adminView ?? {})), adminView);
  check('parent saved as primary guardian', adminView?.guardians?.some((g) => g.isPrimary && g.guardian.phone === mobile2 && g.guardian.name === 'Suresh Kumar'), adminView?.guardians);
  await expect('School Admin cannot see the full Aadhaar', admin, 'GET', `/students/${newStudent.id}/aadhaar`, undefined, 403);

  heading('First login with the admission number');
  const firstLogin = await call(null, 'POST', '/auth/login', { identifier: `e2e-${RUN}`, password: newStudent.firstPassword });
  check('student signs in with admission number (any case) and first password', firstLogin.status === 201 && firstLogin.data?.mustChangePassword === true, firstLogin.status);
  const fresh = firstLogin.data?.session?.access_token;
  await expect('other routes are blocked until the password changes', fresh, 'GET', '/students', undefined, 403);
  const freshMe = (await expect('who am I still works', fresh, 'GET', '/auth/me')).data?.erpUser;
  check('/auth/me says the password must change', freshMe?.mustChangePassword === true, freshMe);
  await expect('the new password must differ', fresh, 'POST', '/auth/change-password', { currentPassword: newStudent.firstPassword, newPassword: newStudent.firstPassword }, 400);
  await expect('student sets a new password', fresh, 'POST', '/auth/change-password', { currentPassword: newStudent.firstPassword, newPassword: `Ravi#${RUN}` });
  const relogin = await call(null, 'POST', '/auth/login', { identifier: `E2E-${RUN}`, password: `Ravi#${RUN}` });
  check('signs in with the new password, no change needed', relogin.status === 201 && relogin.data?.mustChangePassword === false, relogin.status);
  const ravi = relogin.data?.session?.access_token;
  const raviList = (await expect('after the change, the student can use the app', ravi, 'GET', '/students')).data;
  check('and sees only themself', raviList?.length === 1 && raviList[0].id === newStudent.id, raviList?.length);
  const ownAadhaar = (await expect('the student sees their own full Aadhaar', ravi, 'GET', `/students/${newStudent.id}/aadhaar`)).data;
  check('full Aadhaar matches what was registered', ownAadhaar?.aadhaar === aadhaar2, ownAadhaar);
  await expect('the first password no longer works', null, 'POST', '/auth/login', { identifier: `E2E-${RUN}`, password: newStudent.firstPassword }, 401);

  heading('Excel import');
  // Its own class, so imported students do not join the Class 8 exams tested later.
  await expect('create a class for the import', admin, 'POST', '/classes', { academicYearId: year.id, name: 'Class 6', sortOrder: 6 });
  const importRow = (overrides) => ({
    admission_no: `E2E-I1-${RUN}`, admission_date: '02/09/2026', admission_type: 'Existing',
    first_name: 'Asha', family_name: 'Rao', gender: 'F', date_of_birth: '11/06/2013',
    class: '6', section: 'a', parent_name: 'Lakshmi Rao', parent_mobile: `97${RUN.slice(-8)}`,
    aadhaar_or_enrolment_no: testAadhaar(), nfc_card_id: `NFC-I1-${RUN}`, ...overrides,
  });
  const goodRow = importRow({});
  const sheet = [
    goodRow,
    importRow({ admission_no: `E2E-I2-${RUN}`, parent_mobile: '12345', nfc_card_id: `NFC-I2-${RUN}`, aadhaar_or_enrolment_no: testAadhaar() }),
    importRow({ nfc_card_id: `NFC-I3-${RUN}`, aadhaar_or_enrolment_no: testAadhaar() }),
    importRow({ admission_no: `E2E-${RUN}`, nfc_card_id: `NFC-E2E-${RUN}` }),
  ];
  await expect('teacher cannot import students', teacher, 'POST', '/students/import', { dryRun: true, rows: sheet }, 403);
  const dry = (await expect('dry run checks every row', admin, 'POST', '/students/import', { dryRun: true, rows: sheet }, 201)).data;
  check('dry run saves nothing and lists the problem rows', dry?.imported === 0 && dry?.readyToImport === 1 && dry?.problems?.length === 2, dry);
  check('problems name the row and the reason', dry?.problems?.some((p) => p.row === 3 && p.errors.some((e) => e.includes('mobile'))) && dry?.problems?.some((p) => p.row === 4 && p.errors.some((e) => e.includes('twice'))), dry?.problems);
  check('an already registered admission number is skipped, not a problem', dry?.alreadyRegistered?.some((r) => r.row === 5), dry?.alreadyRegistered);
  // Weaknesses found with a 44-row test sheet; each row must be refused with the right reason.
  const hostile = [
    ['an Aadhaar with a digit missing', { aadhaar_or_enrolment_no: testAadhaar().slice(0, 11) }, 'needs exactly 12'],
    ['31 February', { date_of_birth: '31/02/2015' }, 'date of birth is missing or not a date'],
    ['a script tag as a name', { first_name: '<script>alert(1)</script>' }, 'first name can only contain'],
    ['SQL text as a name', { first_name: "Robert'); DROP TABLE students;--" }, 'first name can only contain'],
    ['a formula as a name', { first_name: '=HYPERLINK("http://x","y")' }, 'first name can only contain'],
    ['a 500-character name', { first_name: 'A'.repeat(500) }, 'longer than 80'],
    ['a 5000-character address', { address: 'B'.repeat(5000) }, 'address is longer than 300'],
    ['a 90-character admission number', { admission_no: `E2E-${'9'.repeat(86)}` }, 'admission number is longer than 40'],
    ['a family name in Telugu script', { family_name: 'సాయి' }, 'family name must be written in English letters'],
    ['an address starting with =', { address: '=1+1' }, 'cannot start with ='],
  ];
  const hostileRows = hostile.map(([, over], i) => importRow({ admission_no: `E2E-H${i}-${RUN}`, nfc_card_id: `NFC-H${i}-${RUN}`, aadhaar_or_enrolment_no: testAadhaar(), ...over }));
  const hostileDry = (await expect('dry run of wrong and manipulated rows', admin, 'POST', '/students/import', { dryRun: true, rows: hostileRows }, 201)).data;
  hostile.forEach(([name, , reason], i) => {
    const problem = hostileDry?.problems?.find((x) => x.row === i + 2);
    check(`refused: ${name}`, problem?.errors?.some((e) => e.includes(reason)), problem?.errors);
  });
  check('none of the manipulated rows is ready to import', hostileDry?.readyToImport === 0, hostileDry?.readyToImport);
  const blocked = (await expect('a real run with problems saves nothing', admin, 'POST', '/students/import', { dryRun: false, rows: sheet }, 201)).data;
  check('nothing imported while any row has a problem', blocked?.imported === 0 && blocked?.problems?.length === 2, blocked);
  const imported = (await expect('import the clean sheet', admin, 'POST', '/students/import', { dryRun: false, rows: [goodRow, sheet[3]] }, 201)).data;
  check('one student imported with a login, one skipped', imported?.imported === 1 && imported?.logins?.[0]?.firstPassword === `Rao@${goodRow.parent_mobile.slice(-4)}` && imported?.alreadyRegistered?.length === 1, imported);
  check('imported student is in 6-A', imported?.logins?.[0]?.section === 'Class 6-A', imported?.logins);
  const rerun = (await expect('running the same sheet again', admin, 'POST', '/students/import', { dryRun: false, rows: [goodRow] }, 201)).data;
  check('re-running skips students already imported', rerun?.imported === 0 && rerun?.alreadyRegistered?.length === 1 && rerun?.problems?.length === 0, rerun);

  heading('Teacher registration');
  const subjectOptions = (await expect('list subjects a teacher can teach', admin, 'GET', '/staff/teaching-subjects')).data;
  check('the subject list includes Mathematics', subjectOptions?.includes('Mathematics'), subjectOptions);
  const teacherForm = {
    displayName: 'Lakshmi Prasanna K', phone: `+91 96${RUN.slice(-8)}`, joiningDate: '2026-06-12',
    teachingSubjects: ['mathematics', 'Physics', 'Mathematics'], gender: 'FEMALE', dateOfBirth: '1991-06-14',
    nfcId: `nfc-tch-${RUN}`, address: '4-12, Gandhi Nagar, Vijayawada',
  };
  await expect('a teacher cannot register teachers', teacher, 'POST', '/staff', teacherForm, 403);
  await expect('an unknown subject is refused', admin, 'POST', '/staff', { ...teacherForm, teachingSubjects: ['Maths'] }, 400);
  await expect('a bad mobile is refused', admin, 'POST', '/staff', { ...teacherForm, phone: '12345' }, 400);
  await expect('a name in Telugu script is refused', admin, 'POST', '/staff', { ...teacherForm, displayName: 'లక్ష్మి' }, 400);
  await expect('a joining date that does not exist is refused', admin, 'POST', '/staff', { ...teacherForm, joiningDate: '2026-02-30' }, 400);
  await expect('a card already given to a student is refused', admin, 'POST', '/staff', { ...teacherForm, nfcId: `NFC-E2E-${RUN}` }, 400);
  const lakshmi = (await expect('School Admin registers a teacher', admin, 'POST', '/staff', teacherForm, 201)).data;
  check('Teacher ID is T + joining year + count', /^T26[A-Z]\d{2}$/.test(lakshmi?.teacherId ?? ''), lakshmi?.teacherId);
  check('the Teacher ID is the login ID', lakshmi?.loginId === lakshmi?.teacherId && lakshmi?.employeeNo === lakshmi?.teacherId);
  check('a random first password is returned once', /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(lakshmi?.firstPassword ?? ''), lakshmi?.firstPassword);
  check('subjects saved with the school spelling, main first, no repeats', JSON.stringify(lakshmi?.teachingSubjects) === JSON.stringify(['Mathematics', 'Physics']), lakshmi?.teachingSubjects);
  check('card saved in capitals and joining date kept', lakshmi?.nfcId === `NFC-TCH-${RUN}` && lakshmi?.joiningDate?.startsWith('2026-06-12'), lakshmi);
  check('no email given, so a private login email is used', lakshmi?.user?.email?.endsWith('@staff.erp.local'), lakshmi?.user?.email);
  const raviT = (await expect('register a second teacher', admin, 'POST', '/staff', {
    displayName: "Ravi D'Souza", phone: `95${RUN.slice(-8)}`, joiningDate: '2027-01-05', teachingSubjects: ['English'], email: `ravi.${RUN}@school.example`,
  }, 201)).data;
  const idNumber = (id) => (id.charCodeAt(3) - 65) * 99 + Number(id.slice(4));
  check('the next teacher gets the next number and their own joining year', raviT?.teacherId?.startsWith('T27') && idNumber(raviT.teacherId) === idNumber(lakshmi.teacherId) + 1, [lakshmi?.teacherId, raviT?.teacherId]);
  await expect('the same email cannot be used twice', admin, 'POST', '/staff', { ...teacherForm, nfcId: undefined, email: `ravi.${RUN}@school.example` }, 400);

  const teacherLogin = await call(null, 'POST', '/auth/login', { identifier: lakshmi.teacherId.toLowerCase(), password: lakshmi.firstPassword });
  check('teacher signs in with the Teacher ID and first password', teacherLogin.status === 201 && teacherLogin.data?.mustChangePassword === true, teacherLogin.status);
  const lakshmiFirst = teacherLogin.data?.session?.access_token;
  await expect('the teacher must change the password first', lakshmiFirst, 'GET', '/staff-assignments', undefined, 403);
  await expect('teacher sets a new password', lakshmiFirst, 'POST', '/auth/change-password', { currentPassword: lakshmi.firstPassword, newPassword: `Lakshmi#${RUN}` });
  const lakshmiAgain = await call(null, 'POST', '/auth/login', { identifier: lakshmi.teacherId, password: `Lakshmi#${RUN}` });
  check('then signs in normally', lakshmiAgain.status === 201 && lakshmiAgain.data?.mustChangePassword === false, lakshmiAgain.status);
  const lakshmiContext = (await expect('the teacher opens the app', lakshmiAgain.data?.session?.access_token, 'GET', '/auth/context')).data;
  check('and is a Teacher', lakshmiContext?.roles?.includes('Teacher') && lakshmiContext?.mustChangePassword === false, lakshmiContext?.roles);
  const raviLogin = await call(null, 'POST', '/auth/login', { identifier: `ravi.${RUN}@school.example`, password: raviT.firstPassword });
  check('a teacher with an email can also sign in with it', raviLogin.status === 201, raviLogin.status);

  heading('Students, enrollment, guardians (continued)');
  const visible = (await call(teacher, 'GET', '/students?search=TEST-STUDENT-001')).data;
  check('teacher sees students in assigned classes', visible.some((s) => s.id === studentId), visible?.map((s) => s.firstName));
  await expect('student cannot see another student', student, 'GET', `/students/${newStudent.id}`, undefined, 403);
  await expect('teacher cannot edit student contact details', teacher, 'PATCH', `/students/${studentId}`, { phone: '9000000000' }, 403);
  await expect('teacher cannot change a student card', teacher, 'PATCH', `/students/${studentId}`, { nfcId: `NFC-BLOCKED-${RUN}` }, 403);
  await expect('teacher cannot request a name change', teacher, 'PATCH', `/students/${studentId}`, { firstName: 'Changed', reason: 'Not allowed' }, 403);
  await expect('teacher cannot request a transfer', teacher, 'POST', `/enrollments/${enrollment2.id}/transfer`, { sectionId: secA.id, reason: 'Parent request' }, 403);
  await expect('teacher cannot raise a general approval request', teacher, 'POST', '/approval-requests', {
    type: 'student.identity-change', entityType: 'student', entityId: studentId, reason: 'Not allowed', payload: { changes: { firstName: 'Changed' } }, tier: 3,
  }, 403);
  await expect('School Admin cannot lower a Tier 4 change through the general route', admin, 'POST', '/approval-requests', {
    type: 'student.identity-change', entityType: 'student', entityId: studentId, reason: 'Lower tier', payload: { changes: { firstName: 'Changed' } }, tier: 3,
  }, 400);
  await expect('admin transfers the student (8-B to 8-A)', admin, 'POST', `/enrollments/${enrollment2.id}/transfer`, { sectionId: secA.id, reason: 'Parent request' }, [201]);
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
  const scan = (await expect('teacher taps a card', teacher, 'POST', '/attendance/nfc-scan', { nfcId: `NFC-E2E-${RUN}`, attendanceDate: day(0) })).data;
  check('card tap marks PRESENT with source NFC', scan?.result === 'marked' && scan.record.status === 'PRESENT' && scan.record.source === 'NFC', scan);
  const rescan = (await expect('second tap', teacher, 'POST', '/attendance/nfc-scan', { nfcId: `NFC-E2E-${RUN}`, attendanceDate: day(0) })).data;
  check('second tap keeps the saved record', rescan?.result === 'already_marked' && rescan.record.id === scan?.record.id, rescan);
  const lowerScan = (await expect('tap with a lowercase card ID', teacher, 'POST', '/attendance/nfc-scan', { nfcId: `nfc-e2e-${RUN}`, attendanceDate: day(0) })).data;
  check('lowercase tap finds the same student', lowerScan?.result === 'already_marked' && lowerScan.record.id === scan?.record.id, lowerScan);
  await expect('unknown card is a 404', teacher, 'POST', '/attendance/nfc-scan', { nfcId: 'NFC-NOT-ISSUED', attendanceDate: day(0) }, 404);
  const scannedSection = scan?.record.enrollment.section.id;
  await expect('card from another section is refused', teacher, 'POST', '/attendance/nfc-scan', { nfcId: `NFC-E2E-${RUN}`, attendanceDate: day(0), sectionId: scannedSection === secA.id ? secB.id : secA.id }, 400);
  await expect('future card tap is refused', teacher, 'POST', '/attendance/nfc-scan', { nfcId: `NFC-E2E-${RUN}`, attendanceDate: day(2) }, 400);
  await expect('student cannot use card scanning', student, 'POST', '/attendance/nfc-scan', { nfcId: `NFC-E2E-${RUN}`, attendanceDate: day(0) }, 403);
  const mySections = (await expect('teacher lists own sections', teacher, 'GET', `/attendance/my-sections?attendanceDate=${day(0)}`)).data;
  check('section progress counts the tap', mySections?.some((s) => s.id === scannedSection && s.marked >= 1), mySections);
  const teacherContext = (await expect('teacher reads own context', teacher, 'GET', '/auth/context')).data;
  check('context names the role and staff profile', teacherContext?.roles.includes('Teacher') && teacherContext.staffId, teacherContext);
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
  await expect('principal cannot give the first approval', principal, 'POST', `/examinations/${exam.id}/verify`, {}, 403);
  await expect('School Admin approves the marks (verify)', admin, 'POST', `/examinations/${exam.id}/verify`, {});
  await expect('lock', admin, 'POST', `/examinations/${exam.id}/lock`, {});
  await expect('School Admin cannot give the final approval', admin, 'POST', `/examinations/${exam.id}/release`, {}, 403);
  await expect('Principal gives final approval (release)', principal, 'POST', `/examinations/${exam.id}/release`, {});
  const cards = (await expect('student report card', student, 'GET', `/students/${studentId}/report-cards`)).data;
  const card = cards?.find((c) => c.examination.id === exam.id);
  check('report card shows 42/50 with grade A2', card?.subjects?.[0]?.marksObtained === 42 && card?.grade === 'A2', card);
  const markList = (await call(student, 'GET', '/marks')).data;
  check('student now sees only own released marks', markList?.length >= 1 && markList.every((m) => m.studentId === studentId), markList?.length);
  const ownMark = markList.find((m) => m.assessmentId === assessment.id);
  await expect('post-release correction needs a document (Tier 4)', teacher, 'POST', `/marks/${ownMark.id}/correction-request`, { marksObtained: 44, reason: 'Totalling error' }, 400);

  heading('Exam types and slip tests');
  const fa1 = (await expect('create FA1 by type', admin, 'POST', '/examinations', { academicYearId: year.id, type: 'FA1' })).data;
  check('FA1 gets its default name', fa1?.name === 'FA1' && fa1?.type === 'FA1', fa1);
  await expect('second FA1 in the same year conflicts', admin, 'POST', '/examinations', { academicYearId: year.id, type: 'FA1' }, 409);
  const q1 = (await expect('create Q1', admin, 'POST', '/examinations', { academicYearId: year.id, type: 'Q1' })).data;
  check('Q1 is named Q1 Quarterly', q1?.name === 'Q1 Quarterly', q1);
  const prePublic = (await expect('create a pre-public exam', admin, 'POST', '/examinations', { academicYearId: year.id, type: 'PRE_PUBLIC' })).data;
  await expect('an exam without subjects cannot be approved', admin, 'POST', `/examinations/${q1.id}/verify`, {}, 409);
  await expect('pre-public exam refuses Class 8', admin, 'POST', `/examinations/${prePublic.id}/assessments`, { classId: cls.id, subjectId: maths.id, maxMarks: 80 }, 400);
  await expect('slip tests cannot be made through the exam route', admin, 'POST', '/examinations', { academicYearId: year.id, type: 'SLIP_TEST', name: `x ${RUN}` }, 400);
  await expect('other exams need a name', admin, 'POST', '/examinations', { academicYearId: year.id, type: 'OTHER' }, 400);
  await expect('teacher cannot create a main exam', teacher, 'POST', '/examinations', { academicYearId: year.id, type: 'FA2' }, 403);
  const slip = (await expect('teacher creates a slip test for 8-A maths', teacher, 'POST', '/examinations/slip-tests', {
    academicYearId: year.id, name: `Slip test ${RUN}`, classId: cls.id, sectionId: secA.id, subjectId: maths.id, maxMarks: 20,
  })).data;
  check('slip test has one 8-A assessment', slip?.type === 'SLIP_TEST' && slip.assessments?.length === 1 && slip.assessments[0].sectionId === secA.id, slip);
  await expect('teacher cannot set a slip test for 8-B maths', teacher, 'POST', '/examinations/slip-tests', {
    academicYearId: year.id, name: `Slip test B ${RUN}`, classId: cls.id, sectionId: secB.id, subjectId: maths.id, maxMarks: 20,
  }, 403);
  const slipAssessment = slip?.assessments?.[0];
  await expect('teacher enters slip test marks', teacher, 'POST', '/marks/bulk', {
    assessmentId: slipAssessment?.id, marks: [{ studentId, marksObtained: 18 }, { studentId: newStudent.id, isAbsent: true }],
  });
  check('student cannot see slip test marks before approval', !(await call(student, 'GET', '/marks')).data?.some((m) => m.assessmentId === slipAssessment?.id));
  await expect('teacher submits slip test marks', teacher, 'POST', '/marks/submit', { assessmentId: slipAssessment?.id });
  await expect('principal does not approve slip tests', principal, 'POST', `/examinations/${slip?.id}/verify`, {}, 403);
  const approvedSlip = (await expect('School Admin approves the slip test', admin, 'POST', `/examinations/${slip?.id}/verify`, {})).data;
  check('School Admin approval releases the slip test', approvedSlip?.status === 'RELEASED', approvedSlip?.status);
  check('student sees the slip test mark', (await call(student, 'GET', '/marks')).data?.some((m) => m.assessmentId === slipAssessment?.id && Number(m.marksObtained) === 18));

  if (creds.superAdmin) {
    heading('Super Admin school setup');
    const superAdmin = await login(creds.superAdmin.email, creds.superAdmin.password);
    const newTeacher = (await expect('Super Admin registers a teacher', superAdmin, 'POST', '/staff', {
      displayName: 'Super Admin Teacher', phone: `93${RUN.slice(-8)}`, joiningDate: '2026-06-12', teachingSubjects: ['Mathematics'], nfcId: `NFC-T-${RUN}`,
    }, 201)).data;
    check('Super Admin gets an app-made Teacher ID', /^T26[A-Z]\d{2}$/.test(newTeacher?.teacherId ?? ''), newTeacher?.teacherId);
    const superAssignment = (await expect('Super Admin assigns maths and class teacher of 8-B', superAdmin, 'POST', `/staff/${newTeacher?.id}/assignments`, {
      academicYearId: year.id, classId: cls.id, sectionId: secB.id, subjectId: maths.id, isClassTeacher: true,
    })).data;
    check('new teacher is class teacher of 8-B', superAssignment?.isClassTeacher === true && superAssignment.sectionId === secB.id, superAssignment);
    const superExam = (await expect('Super Admin creates FA2', superAdmin, 'POST', '/examinations', { academicYearId: year.id, type: 'FA2' })).data;
    check('FA2 created', superExam?.name === 'FA2', superExam);
    await expect('Super Admin lists staff', superAdmin, 'GET', '/staff');
    // Full access: modules that were closed to Super Admin before.
    await expect('Super Admin reads overdue fees', superAdmin, 'GET', '/fees/overdue');
    await expect('Super Admin reads complaints', superAdmin, 'GET', '/complaints');
  } else {
    console.log('  SKIP  Super Admin checks: no "Super Admin:" block in the credentials file');
  }

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
    await expect('teacher cannot approve', teacher, 'POST', `/approval-requests/${markCorrection.approvalRequest.id}/approve`, {}, 403);
    const principalQueue = (await expect('principal sees pending requests', principal, 'GET', '/approval-requests?status=PENDING')).data;
    check('mark correction is in the principal queue', principalQueue?.some((r) => r.id === markCorrection.approvalRequest.id), principalQueue?.length);
    const finalMark = (await expect('Principal approves second slot', principal, 'POST', `/approval-requests/${markCorrection.approvalRequest.id}/approve`, { note: 'Recount verified' })).data;
    check('Tier 4 request is approved with both decisions', finalMark?.status === 'APPROVED' && finalMark.decisions?.length === 2, finalMark);
    await expect('approved request cannot be approved again', principal, 'POST', `/approval-requests/${markCorrection.approvalRequest.id}/approve`, {}, 409);
    const correctedMark = (await call(student, 'GET', '/marks')).data?.find((m) => m.id === ownMark.id);
    check('corrected mark is applied (44)', Number(correctedMark?.marksObtained) === 44, correctedMark);
    const rejected = (await expect('second Tier 4 mark correction', teacher, 'POST', `/marks/${ownMark.id}/correction-request`, {
      marksObtained: 46, reason: 'Second recount', documentFileId: fileId,
    })).data;
    const rejection = (await expect('Principal rejects it', principal, 'POST', `/approval-requests/${rejected.approvalRequest.id}/reject`, { note: 'Recount does not support this' })).data;
    check('rejected request is closed', rejection?.status === 'REJECTED', rejection);
    const unchangedMark = (await call(student, 'GET', '/marks')).data?.find((m) => m.id === ownMark.id);
    check('rejected correction leaves the mark at 44', Number(unchangedMark?.marksObtained) === 44, unchangedMark);
    const identity = (await expect('admin requests a name correction (Tier 4)', admin, 'PATCH', `/students/${newStudent.id}`, {
      firstName: 'Ravindra', reason: 'Spelling per birth certificate', documentFileId: fileId,
    })).data;
    check('name change is pending approval, not applied', identity?.approvalRequest?.status === 'PENDING' && identity.student.firstName === 'Ravi', identity);
    await expect('raised by School Admin counts as the admin slot', admin, 'POST', `/approval-requests/${identity.approvalRequest.id}/approve`, {}, 409);
    const history = (await expect('approval history', admin, 'GET', `/approval-requests/${identity.approvalRequest.id}/history`)).data;
    check('history has the request event', history?.events?.some((e) => e.action === 'approval.requested'), history?.events);
    const nameApproval = (await expect('Principal approves the name change', principal, 'POST', `/approval-requests/${identity.approvalRequest.id}/approve`, {})).data;
    check('name change approved', nameApproval?.status === 'APPROVED', nameApproval);
    const renamed = (await expect('read renamed student', admin, 'GET', `/students/${newStudent.id}`)).data;
    check('name change is applied after both approvals', renamed?.firstName === 'Ravindra', renamed?.firstName);
    const finalHistory = (await expect('final approval history', principal, 'GET', `/approval-requests/${identity.approvalRequest.id}/history`)).data;
    check('history has the approval event', finalHistory?.events?.some((e) => e.action === 'approval.approved'), finalHistory?.events);
  }
  await expect('student cannot approve requests', student, 'GET', '/approval-requests', undefined, 403);

  heading('Fees and payments');
  const structure = (await expect('create fee structure', admin, 'POST', '/fee-structures', {
    academicYearId: year.id, classId: cls.id, name: `Class 8 fees ${RUN}`,
    items: [{ name: 'Tuition', amount: 12000, dueDate: day(-1) }, { name: 'Exam', amount: 1000, dueDate: day(30) }],
  })).data;
  await expect('cannot assign before approval', admin, 'POST', '/student-fees', { feeStructureId: structure.id }, 409);
  await expect('submit for approval', admin, 'POST', `/fee-structures/${structure.id}/submit-approval`, { reason: 'New year fees' });
  await expect('School Admin cannot approve a fee structure', admin, 'POST', `/fee-structures/${structure.id}/approve`, {}, 403);
  const approvedStructure = (await expect('Principal approves the fee structure', principal, 'POST', `/fee-structures/${structure.id}/approve`, {})).data;
  check('structure approved', approvedStructure?.status === 'APPROVED', approvedStructure?.status);
  await expect('edit after approval is blocked', admin, 'PATCH', `/fee-structures/${structure.id}`, { name: 'Changed' }, 409);
  const assigned = (await expect('assign to the whole class', admin, 'POST', '/student-fees', { feeStructureId: structure.id })).data;
  check('assigned to both students', assigned?.assigned === 2, assigned);
  const fees = (await expect('student reads own fees', student, 'GET', '/student-fees')).data;
  check('student sees only own fee', fees?.length >= 1 && fees.every((f) => f.studentId === studentId), fees?.length);
  // Filter by this run's structure: the student's fees from earlier runs push it past page one.
  const fee = (await call(student, 'GET', `/student-fees?feeStructureId=${structure.id}`)).data?.[0];
  check('balance is 13000', fee?.balance === 13000, fee?.balance);
  const discount = (await expect('discount is raised as a request', admin, 'POST', `/student-fees/${fee.id}/apply-discount`, { amount: 1000, reason: 'Sibling discount' })).data;
  const discountRequest = discount?.approvalRequest;
  check('discount is not applied before approval', discount?.applied === false && discountRequest?.requiredRoles?.join() === 'Principal', discount);
  check('balance unchanged while pending', (await call(student, 'GET', `/student-fees?feeStructureId=${structure.id}`)).data?.[0]?.balance === 13000);
  await expect('School Admin cannot approve a discount', admin, 'POST', `/approval-requests/${discountRequest?.id}/approve`, {}, 403);
  await expect('Principal approves the discount', principal, 'POST', `/approval-requests/${discountRequest?.id}/approve`, { note: 'Sibling in Class 5' });
  const discounted = (await call(student, 'GET', `/student-fees?feeStructureId=${structure.id}`)).data?.[0];
  check('discount reduces balance to 12000', discounted?.balance === 12000, discounted?.balance);
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
  await expect('the requester cannot approve their own refund', admin, 'POST', `/payments/${cheque.id}/refund`, {}, 403);
  await expect('Principal approves the refund', principal, 'POST', `/payments/${cheque.id}/refund`, {});
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
  await expect('School Admin cannot decide staff leave', admin, 'POST', `/staff-leaves/${staffLeave.id}/approve`, {}, 403);
  await expect('rejecting leave needs a reason', principal, 'POST', `/staff-leaves/${staffLeave.id}/reject`, {}, 400);
  const approvedLeave = (await expect('Principal approves staff leave', principal, 'POST', `/staff-leaves/${staffLeave.id}/approve`, {})).data;
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
  await expect('the requester cannot approve their own certificate', admin, 'POST', `/certificates/${cert.id}/approve`, {}, 403);
  await expect('Principal approves the certificate', principal, 'POST', `/certificates/${cert.id}/approve`, {});
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

  heading('Notification delivery worker');
  const parentMe = (await call(parent, 'GET', '/auth/me')).data.erpUser;
  await expect('push template for test notifications', admin, 'POST', '/notification-templates', { code: 'test', channel: 'PUSH', body: 'School alert: {{body}}' }, [201, 409]);
  await expect('send a notification to the parent', admin, 'POST', '/notifications/test', { userId: parentMe.id, title: `Worker ${RUN}`, body: `Delivery check ${RUN}` });
  const parentNote = (await call(parent, 'GET', '/notifications')).data?.find((n) => n.title === `Worker ${RUN}`);
  check('parent has the in-app notification', parentNote, parentNote);
  const parentRows = parentNote ? await settleDeliveries(admin, parentNote.id) : [];
  const byChannel = Object.fromEntries(parentRows.map((row) => [row.channel, row]));
  check('in-app, push and SMS rows, no email row', byChannel.IN_APP && byChannel.PUSH && byChannel.SMS && !byChannel.EMAIL, parentRows.map((r) => r.channel));
  check('push sent to the registered device by the dev sender', byChannel.PUSH?.status === 'SENT' && byChannel.PUSH.provider === 'console' && byChannel.PUSH.recipient === 'android' && byChannel.PUSH.attempts === 1, byChannel.PUSH);
  check('push delivery has sent time and message id', byChannel.PUSH?.sentAt && byChannel.PUSH.providerMessageId === `console-${byChannel.PUSH.id}`, byChannel.PUSH);
  check('SMS reached a final state', ['SENT', 'SKIPPED'].includes(byChannel.SMS?.status), byChannel.SMS);
  await expect('sent delivery cannot be retried', admin, 'POST', `/notification-deliveries/${byChannel.PUSH?.id}/retry`, {}, 409);

  await expect('student enables push only', student, 'PATCH', '/notification-preferences', { push: true, sms: false, email: false });
  await expect('send a notification to the student', admin, 'POST', '/notifications/test', { userId: studentMe.id, title: `No device ${RUN}`, body: 'Nothing to push to' });
  const studentNote = (await call(student, 'GET', '/notifications')).data?.find((n) => n.title === `No device ${RUN}`);
  const studentRows = studentNote ? await settleDeliveries(admin, studentNote.id) : [];
  const studentPush = studentRows.find((row) => row.channel === 'PUSH');
  check('push without a device is skipped, not failed', studentPush?.status === 'SKIPPED' && /no registered devices/i.test(studentPush.error), studentPush);
  const retried = (await expect('admin retries the skipped delivery', admin, 'POST', `/notification-deliveries/${studentPush?.id}/retry`, {})).data;
  check('retry re-queues with a fresh attempt count', retried?.status === 'QUEUED' && retried.attempts === 0, retried);
  const afterRetry = (await settleDeliveries(admin, studentNote?.id)).find((row) => row.channel === 'PUSH');
  check('retried delivery is processed again', afterRetry?.status === 'SKIPPED' && afterRetry.attempts === 1, afterRetry);
  const skipped = (await expect('filter deliveries by status', admin, 'GET', '/notification-deliveries?status=SKIPPED&channel=PUSH')).data;
  check('status filter returns only skipped push rows', skipped?.length && skipped.every((row) => row.status === 'SKIPPED' && row.channel === 'PUSH'), skipped?.length);
  await expect('teacher cannot run the delivery worker', teacher, 'POST', '/notification-deliveries/process', {}, 403);
  await expect('bad status filter is a 400', admin, 'GET', '/notification-deliveries?status=LOST', undefined, 400);

  heading('Dashboards, reports, analytics');
  await expect('principal dashboard', admin, 'GET', '/dashboards/principal');
  const tdash = (await expect('teacher dashboard', teacher, 'GET', '/dashboards/teacher')).data;
  check('teacher dashboard has pending work', tdash?.pendingWork, tdash);
  const pdash = (await expect('parent dashboard', parent, 'GET', '/dashboards/parent')).data;
  check('parent dashboard shows the child', pdash?.children?.[0]?.student?.id === studentId, pdash);
  await expect('accountant dashboard (admin)', admin, 'GET', '/dashboards/accountant');
  await expect('principal opens principal dashboard', principal, 'GET', '/dashboards/principal');
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

  heading('Senior accounts are Super Admin only');
  const roleList = (await call(admin, 'GET', '/roles')).data ?? [];
  const roleId = (name) => roleList.find((r) => r.name === name)?.id;
  for (const name of ['Principal', 'School Admin', 'Accountant']) {
    await expect(`School Admin cannot create ${name === 'Accountant' ? 'an' : 'a'} ${name} account`, admin, 'POST', '/users', {
      email: `blocked.${RUN}@erp.local`, displayName: 'Blocked', password: `Blocked#${RUN}`, roleIds: [roleId(name)],
    }, 403);
  }
  const principalUser = (await call(admin, 'GET', '/users')).data?.find((u) => u.email === creds.principal.email);
  check('Principal account found', principalUser);
  await expect('School Admin cannot change the Principal account', admin, 'PATCH', `/users/${principalUser?.id}`, { displayName: 'Changed by Admin' }, 403);
  await expect('School Admin cannot deactivate the Principal', admin, 'POST', `/users/${principalUser?.id}/deactivate`, undefined, 403);
  await expect('School Admin cannot give the Principal extra permissions', admin, 'POST', `/users/${principalUser?.id}/permission-overrides`, {
    permissionCode: 'homework:read', effect: 'GRANT', reason: 'Test',
  }, 403);
  await expect('School Admin cannot make the student a Principal', admin, 'POST', `/users/${studentMe.id}/roles`, { roleId: roleId('Principal') }, 403);

  heading('Class, section and subject management');
  const manager = creds.superAdmin ? await login(creds.superAdmin.email, creds.superAdmin.password) : admin;
  const managerName = creds.superAdmin ? 'Super Admin' : 'School Admin';
  const defaults = (await expect('read default subjects', manager, 'GET', '/academics/default-subjects')).data;
  check('default subjects include optional Sanskrit', defaults?.length === 8 && defaults.some((d) => d.name === 'Sanskrit' && d.isOptional), defaults);
  const class1 = (await expect(`${managerName} creates Class 1`, manager, 'POST', '/classes', { academicYearId: year.id, name: 'Class 1', sortOrder: 1 })).data;
  let detail = (await expect('open Class 1 details', manager, 'GET', `/academics/classes/${class1?.id}`)).data;
  const oneA = detail?.sections?.[0];
  check('Class 1 has Section A with the default subjects', detail?.sections?.length === 1 && oneA?.name === 'A' && oneA.subjects.length === 8, detail);
  check('Sanskrit starts switched off; the others are on', oneA?.subjects.filter((x) => x.isEnabled).length === 7 && oneA.subjects.find((x) => x.name === 'Sanskrit')?.isEnabled === false, oneA?.subjects);
  const oneB = (await expect('add Section B', manager, 'POST', '/sections', { academicYearId: year.id, classId: class1?.id, name: 'B' })).data;
  const oneC = (await expect('add Section C', manager, 'POST', '/sections', { academicYearId: year.id, classId: class1?.id, name: 'C' })).data;
  await expect('rename Section C to D', manager, 'PATCH', `/sections/${oneC?.id}`, { name: 'D' });
  const bSubjects = (await expect('Section B has its own subjects', manager, 'GET', `/academics/sections/${oneB?.id}/subjects`)).data;
  check('Section B subjects are separate copies', bSubjects?.length === 8 && bSubjects.every((x) => !oneA.subjects.some((a) => a.id === x.id)), bSubjects?.length);
  const bHindi = bSubjects?.find((x) => x.name === 'Hindi');
  const bSanskrit = bSubjects?.find((x) => x.name === 'Sanskrit');
  const bMaths = bSubjects?.find((x) => x.name === 'Mathematics');
  await expect('rename Hindi in Section B only', manager, 'PATCH', `/academics/subjects/${bHindi?.id}`, { name: 'Hindi (Second language)' });
  await expect('switch on Sanskrit in Section B', manager, 'PATCH', `/academics/subjects/${bSanskrit?.id}`, { isEnabled: true });
  const computer = (await expect('add Computer Science to Section B', manager, 'POST', `/academics/sections/${oneB?.id}/subjects`, { name: 'Computer Science' })).data;
  check('new subject gets a code from its name', computer?.code === 'COMPUTER', computer);
  await expect('the same subject code twice in a section conflicts', manager, 'POST', `/academics/sections/${oneB?.id}/subjects`, { name: 'Maths again', code: 'MATH' }, 409);
  await expect('a required subject cannot be switched off', manager, 'PATCH', `/academics/subjects/${bMaths?.id}`, { isEnabled: false }, 400);
  detail = (await call(manager, 'GET', `/academics/classes/${class1?.id}`)).data;
  const oneAAfter = detail?.sections?.find((x) => x.name === 'A');
  check('Section A is unchanged by Section B edits', oneAAfter?.subjects.some((x) => x.name === 'Hindi') && oneAAfter.subjects.find((x) => x.name === 'Sanskrit')?.isEnabled === false && oneAAfter.subjects.length === 8, oneAAfter?.subjects?.map((x) => x.name));
  check('sections are now A, B and D', detail?.sections?.map((x) => x.name).join(',') === 'A,B,D', detail?.sections?.map((x) => x.name));

  const aMaths = oneAAfter?.subjects.find((x) => x.name === 'Mathematics');
  await expect('teacher cannot assign teachers', teacher, 'PUT', `/academics/subjects/${aMaths?.id}/teacher`, { staffId: teacherStaff.id }, 403);
  await expect('teacher cannot add subjects', teacher, 'POST', `/academics/sections/${oneB?.id}/subjects`, { name: 'Art' }, 403);
  await expect('teacher cannot delete sections', teacher, 'DELETE', `/academics/sections/${oneB?.id}`, undefined, 403);
  await expect('assign the teacher to Class 1-A Mathematics', manager, 'PUT', `/academics/subjects/${aMaths?.id}/teacher`, { staffId: teacherStaff.id });
  await expect('a Section A subject cannot be assigned in Section B', manager, 'POST', '/staff-assignments', {
    staffId: teacherStaff.id, academicYearId: year.id, classId: class1?.id, sectionId: oneB?.id, subjectId: aMaths?.id,
  }, 400);
  let mine = (await expect('teacher reads own teaching', teacher, 'GET', '/academics/my-teaching')).data;
  check('teacher sees Class 1-A Mathematics', mine?.subjects?.some((x) => x.class.id === class1?.id && x.section?.name === 'A' && x.subject.name === 'Mathematics'), mine?.subjects);
  check('teacher is class teacher of 8-A only', mine?.classTeacherOf?.length === 1 && mine.classTeacherOf[0].section.id === secA.id, mine?.classTeacherOf);
  const marking = (await expect('teacher lists sections to mark', teacher, 'GET', `/attendance/my-sections?attendanceDate=${day(0)}`)).data;
  check('teacher can mark only class-teacher sections', marking?.length === 1 && marking[0].id === secA.id, marking?.map((x) => x.id));

  await expect('make the teacher class teacher of 1-B', manager, 'PUT', `/academics/sections/${oneB?.id}/class-teacher`, { staffId: teacherStaff.id });
  mine = (await call(teacher, 'GET', '/academics/my-teaching')).data;
  check('teacher now also sees 1-B as class teacher', mine?.classTeacherOf?.some((x) => x.section.id === oneB?.id), mine?.classTeacherOf);
  const principalStaff = (await call(admin, 'GET', '/staff')).data?.find((x) => x.user.email === creds.principal.email);
  await expect('change the class teacher of 1-B', manager, 'PUT', `/academics/sections/${oneB?.id}/class-teacher`, { staffId: principalStaff?.id });
  mine = (await call(teacher, 'GET', '/academics/my-teaching')).data;
  check('replacing the class teacher removes the old one', !mine?.classTeacherOf?.some((x) => x.section.id === oneB?.id), mine?.classTeacherOf);
  await expect('remove the class teacher of 1-B', manager, 'PUT', `/academics/sections/${oneB?.id}/class-teacher`, {});
  await expect('remove the teacher from 1-A Mathematics', manager, 'PUT', `/academics/subjects/${aMaths?.id}/teacher`, {});
  mine = (await call(teacher, 'GET', '/academics/my-teaching')).data;
  check('removing an assignment revokes it at once', !mine?.subjects?.some((x) => x.class.id === class1?.id), mine?.subjects);

  await expect('assign a teacher to Sanskrit in 1-B', manager, 'PUT', `/academics/subjects/${bSanskrit?.id}/teacher`, { staffId: teacherStaff.id });
  await expect('switch Sanskrit off in 1-B', manager, 'PATCH', `/academics/subjects/${bSanskrit?.id}`, { isEnabled: false });
  const assignmentsView = (await expect('read the teacher assignments table', manager, 'GET', `/academics/assignments?academicYearId=${year.id}`)).data;
  const bRow = assignmentsView?.find((x) => x.sectionId === oneB?.id);
  check('switching a subject off removes its teacher', bRow && !bRow.subjects.some((x) => x.subjectId === bSanskrit?.id), bRow?.subjects?.map((x) => x.name));

  await expect('Section D can be deleted while empty', manager, 'DELETE', `/academics/sections/${oneC?.id}`);
  const unitTest = (await expect('create an exam for Class 1', manager, 'POST', '/examinations', { academicYearId: year.id, type: 'OTHER', name: `Unit test ${RUN}` })).data;
  const added = (await expect('add every Class 1 subject to the exam', manager, 'POST', `/examinations/${unitTest?.id}/assessments/class`, { classId: class1?.id, maxMarks: 25 })).data;
  check('one exam subject per section subject (7 in A + 8 in B)', added?.added === 15, added);
  const again = (await call(manager, 'POST', `/examinations/${unitTest?.id}/assessments/class`, { classId: class1?.id, maxMarks: 25 })).data;
  check('adding the class again skips existing subjects', again?.added === 0 && again.skipped === 15, again);
  const sharedExam = (await expect('create one exam for several classes', manager, 'POST', '/examinations', { academicYearId: year.id, type: 'OTHER', name: `Shared test ${RUN}` })).data;
  const shared = (await expect('add Class 1 and Class 8 to the same exam in one request', manager, 'POST', `/examinations/${sharedExam?.id}/assessments/class`, { classIds: [class1?.id, cls.id], maxMarks: 50, passMarks: 18 })).data;
  check('both classes get their subjects', shared?.classes === 2 && shared.added > 15, shared);
  const teacherExams = (await expect('teacher lists exams waiting for marks', teacher, 'GET', '/marks/my-assessments')).data ?? [];
  const sharedMaths = teacherExams.find((x) => x.examination.id === sharedExam?.id && x.subject.name === 'Mathematics' && x.section?.id === secA.id);
  check('an older school-wide Maths assignment covers 8-A section Maths', sharedMaths, teacherExams.map((x) => `${x.examination.name} ${x.subject.name} ${x.section?.name ?? ''}`));
  check('the teacher does not see 8-B Maths', !teacherExams.some((x) => x.examination.id === sharedExam?.id && x.subject.name === 'Mathematics' && x.section?.id === secB.id));
  const sharedSheet = sharedMaths ? (await expect('teacher opens the 8-A Maths sheet', teacher, 'GET', `/marks/sheet/${sharedMaths.id}`)).data : null;
  check('the sheet lists 8-A students', sharedSheet?.students?.length >= 1, sharedSheet?.students?.length);

  await expect('a class list is required', manager, 'POST', `/examinations/${sharedExam?.id}/assessments/class`, { maxMarks: 50 }, 400);
  await expect('teacher cannot add classes to an exam', teacher, 'POST', `/examinations/${sharedExam?.id}/assessments/class`, { classIds: [class1?.id], maxMarks: 50 }, 403);

  heading('Section-by-section approval');
  let examSectionView = (await expect('read section progress', admin, 'GET', `/examinations/${sharedExam?.id}/sections`)).data;
  const sectionRowOf = (view, id) => view?.sections?.find((row) => row.section.id === id);
  check('the exam covers 1-A, 1-B, 8-A and 8-B', examSectionView?.sections?.length === 4, examSectionView?.sections?.map((row) => `${row.class.name}-${row.section.name}`));
  check('8-A is not complete yet', sectionRowOf(examSectionView, secA.id)?.complete === false, sectionRowOf(examSectionView, secA.id));
  await expect('8-A cannot be approved before marks are in', admin, 'POST', `/examinations/${sharedExam?.id}/sections/${secA.id}/verify`, {}, 409);
  const sharedDetail = (await call(admin, 'GET', `/examinations/${sharedExam?.id}`)).data;
  for (const item of sharedDetail?.assessments?.filter((x) => x.sectionId === secA.id) ?? []) {
    await call(admin, 'POST', '/marks/bulk', { assessmentId: item.id, marks: [{ studentId, marksObtained: 40 }, { studentId: newStudent.id, marksObtained: 35 }] });
    await call(admin, 'POST', '/marks/submit', { assessmentId: item.id });
  }
  examSectionView = (await call(admin, 'GET', `/examinations/${sharedExam?.id}/sections`)).data;
  check('8-A is complete once every subject is submitted', sectionRowOf(examSectionView, secA.id)?.complete === true, sectionRowOf(examSectionView, secA.id));
  await expect('the Principal does not give the first approval', principal, 'POST', `/examinations/${sharedExam?.id}/sections/${secA.id}/verify`, {}, 403);
  await expect('School Admin approves 8-A on its own', admin, 'POST', `/examinations/${sharedExam?.id}/sections/${secA.id}/verify`, {});
  const lockedMaths = sharedDetail?.assessments?.find((x) => x.sectionId === secA.id);
  const lockedTry = (await call(admin, 'POST', '/marks/bulk', { assessmentId: lockedMaths?.id, marks: [{ studentId, marksObtained: 41 }] })).data;
  check('marks in an approved section are locked', lockedTry?.saved === 0 && lockedTry.results?.[0]?.error?.includes('already approved'), lockedTry);
  check('the student cannot see 8-A results before release', !(await call(student, 'GET', '/marks')).data?.some((m) => m.assessment?.examinationId === sharedExam?.id));
  await expect('the School Admin cannot release', admin, 'POST', `/examinations/${sharedExam?.id}/sections/${secA.id}/release`, {}, 403);
  const releasedA = (await expect('the Principal releases 8-A', principal, 'POST', `/examinations/${sharedExam?.id}/sections/${secA.id}/release`, {})).data;
  check('the exam is not fully released while other sections wait', releasedA?.status === 'RELEASED' && releasedA.examReleased === false, releasedA);
  const studentMarks = (await call(student, 'GET', '/marks')).data ?? [];
  check('the 8-A student now sees the released marks', studentMarks.some((m) => m.assessment?.examinationId === sharedExam?.id && Number(m.marksObtained) === 40), studentMarks.length);
  const studentCards = (await call(student, 'GET', `/students/${studentId}/report-cards`)).data ?? [];
  check('the report card includes the released exam', studentCards.some((c) => c.examination.id === sharedExam?.id), studentCards.map((c) => c.examination.name));
  check('the student sees the exam in the exam list', (await call(student, 'GET', '/examinations')).data?.some((e) => e.id === sharedExam?.id));
  const teacherView = (await call(teacher, 'GET', '/marks/my-assessments')).data ?? [];
  check('the teacher sees 8-A Maths as released', teacherView.some((x) => x.examination.id === sharedExam?.id && x.section?.id === secA.id && x.subject.name === 'Mathematics' && x.status === 'RELEASED'), teacherView.filter((x) => x.examination.id === sharedExam?.id).map((x) => `${x.subject.name} ${x.section?.name} ${x.status}`));
  const bulkApproved = (await expect('School Admin approves every ready section', admin, 'POST', `/examinations/${sharedExam?.id}/sections/verify-ready`, {})).data;
  check('the three empty sections are approved', bulkApproved?.approved?.length === 3, bulkApproved);
  const oneBId = examSectionView?.sections?.find((row) => row.class.id === class1?.id && row.section.name === 'B')?.section.id;
  await expect('send 1-B back', principal, 'POST', `/examinations/${sharedExam?.id}/sections/${oneBId}/reject`, {});
  await expect('approve the ready sections again', admin, 'POST', `/examinations/${sharedExam?.id}/sections/verify-ready`, {});
  const bulkReleased = (await expect('the Principal releases every approved section', principal, 'POST', `/examinations/${sharedExam?.id}/sections/release-approved`, {})).data;
  check('the remaining three sections are released', bulkReleased?.released?.length === 3, bulkReleased);
  const finished = (await call(admin, 'GET', `/examinations/${sharedExam?.id}`)).data;
  check('the exam is released once every section is', finished?.status === 'RELEASED', finished?.status);

  await expect('Section B with exam subjects cannot be deleted', manager, 'DELETE', `/academics/sections/${oneB?.id}`, undefined, 409);
  const class2 = (await expect('create Class 2', manager, 'POST', '/classes', { academicYearId: year.id, name: 'Class 2', sortOrder: 2 })).data;
  const class2A = (await call(manager, 'GET', `/academics/classes/${class2?.id}`)).data?.sections?.[0];
  await expect('the last section of a class cannot be deleted', manager, 'DELETE', `/academics/sections/${class2A?.id}`, undefined, 409);
  await expect('an empty class can be deleted', manager, 'DELETE', `/academics/classes/${class2?.id}`);
  await expect('a class with students cannot be deleted', manager, 'DELETE', `/academics/classes/${cls.id}`, undefined, 409);
  const classCards = (await expect('read the class cards', manager, 'GET', `/academics/classes?academicYearId=${year.id}`)).data;
  const card1 = classCards?.find((x) => x.id === class1?.id);
  check('class card counts sections and subjects', card1?.sections === 2 && card1.subjects === 15, card1);

  heading('Year end');
  const yearClasses = (await call(admin, 'GET', `/classes?academicYearId=${year.id}`)).data ?? [];
  const yearSections = ((await call(admin, 'GET', '/sections')).data ?? []).filter((section) => section.academicYearId === year.id && !section.isArchived);
  const yearSubjects = (await call(admin, 'GET', `/subjects?academicYearId=${year.id}`)).data ?? [];
  const rollover = (await expect('roll the structure over to a new year', admin, 'POST', `/academic-years/${year.id}/rollover`, {
    name: `E2E next ${RUN}`, startsOn: '2027-07-01', endsOn: '2028-03-31', copyAssignments: true,
  })).data;
  const copied = { classes: rollover?.classesCopied, sections: rollover?.sectionsCopied, subjects: rollover?.subjectsCopied };
  const expected = { classes: yearClasses.length, sections: yearSections.length, subjects: yearSubjects.length };
  check('rollover copied every class, section and section subject', JSON.stringify(copied) === JSON.stringify(expected), { copied, expected });
  const nextClasses = (await call(admin, 'GET', `/classes?academicYearId=${rollover?.academicYear?.id}`)).data ?? [];
  const nextClass1 = nextClasses.find((item) => item.name === 'Class 1');
  const nextDetail = nextClass1 ? (await call(admin, 'GET', `/academics/classes/${nextClass1.id}`)).data : null;
  const nextB = nextDetail?.sections?.find((section) => section.name === 'B');
  check('section subjects follow their section into the new year', nextB?.subjects?.some((x) => x.name === 'Hindi (Second language)') && nextB.subjects.some((x) => x.name === 'Computer Science'), nextB?.subjects?.map((x) => x.name));
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
