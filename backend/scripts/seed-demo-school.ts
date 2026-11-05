/**
 * Creates (or refreshes) a realistic demo school for showing the apps:
 * logins for every role, three sections, and about nine weeks of attendance.
 *
 *   npm run prisma:seed-demo
 *
 * Touches only its own organization (slug "demo-school-organization"). Section 6-A is
 * left unmarked for today so it can be marked live. Passwords are regenerated on each
 * run and written to ../demo-accounts.txt, which is git-ignored.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { AttendanceStatus, PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

config();

const prisma = new PrismaClient();
const SCHOOL_DAYS = 45;
const DAY_MS = 86_400_000;

const FIRST_NAMES = [
  'Aarav', 'Ananya', 'Vihaan', 'Diya', 'Arjun', 'Saanvi', 'Karthik', 'Meera', 'Rohan', 'Isha',
  'Aditya', 'Lakshmi', 'Nikhil', 'Pooja', 'Sai', 'Kavya', 'Rahul', 'Sneha', 'Varun', 'Divya',
  'Harsha', 'Nandini', 'Tarun', 'Priya', 'Manoj', 'Swathi', 'Kiran', 'Bhavya', 'Teja', 'Keerthi',
  'Ganesh', 'Sahithi', 'Pranav', 'Anjali', 'Vamsi', 'Tejaswini', 'Charan', 'Harika', 'Akhil', 'Deepika',
  'Sandeep', 'Mounika',
];
const LAST_NAMES = ['Reddy', 'Sharma', 'Naidu', 'Rao', 'Kumar', 'Varma', 'Iyer', 'Patel'];

const SECTIONS = [
  { className: 'Class 6', sortOrder: 6, name: 'A', teacher: 'teacher' },
  { className: 'Class 6', sortOrder: 6, name: 'B', teacher: 'teacher2' },
  { className: 'Class 7', sortOrder: 7, name: 'A', teacher: 'teacher2' },
] as const;

const ANNOUNCEMENTS = [
  { title: 'Parent-teacher meeting', content: 'The term review meeting is on Saturday from 9:30 AM. Report cards will be shared in person.' },
  { title: 'Annual sports day', content: 'Sports day practice starts next Monday. Students should bring their house T-shirts.' },
  { title: 'NFC attendance is live', content: 'Please carry your ID card every day. Tap it on your class teacher\'s phone when you arrive.' },
];

/** Stable pseudo-random value in [0, 1), so re-running gives the same history. */
function noise(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function statusFor(studentIndex: number, dayIndex: number): AttendanceStatus {
  // A few students attend poorly, so the at-risk list has something to show.
  const absentChance = studentIndex % 13 === 5 ? 0.38 : 0.05;
  const roll = noise(studentIndex + 1, dayIndex + 1);
  if (roll < absentChance) return 'ABSENT';
  if (roll < absentChance + 0.04) return 'LATE';
  return 'PRESENT';
}

/** The last `count` weekdays ending today (UTC), oldest first. */
function schoolDays(count: number): Date[] {
  const now = new Date();
  const days: Date[] = [];
  let cursor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  while (days.length < count) {
    const date = new Date(cursor);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days.unshift(date);
    cursor -= DAY_MS;
  }
  return days;
}

async function findAuthUser(client: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Unable to list Supabase Auth users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) return null;
  }
}

async function main(): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: 'demo-school-organization' },
    create: { name: 'Sunrise Education Trust', slug: 'demo-school-organization' },
    update: {},
  });
  const school = await prisma.school.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'SUNRISE-001' } },
    create: { organizationId: organization.id, name: 'Sunrise Public School', code: 'SUNRISE-001' },
    update: { name: 'Sunrise Public School' },
  });
  const schoolId = school.id;

  const credentials: string[] = [];
  const ensureUser = async (key: string, displayName: string, roleName: string) => {
    const email = `demo.${key}@erp.local`;
    const password = `Demo@${randomBytes(9).toString('base64url')}1`;
    const existing = await findAuthUser(adminClient, email);
    const attributes = {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    };
    const { data, error } = existing
      ? await adminClient.auth.admin.updateUserById(existing.id, attributes)
      : await adminClient.auth.admin.createUser(attributes);
    if (error || !data.user) throw new Error(error?.message ?? `Unable to prepare ${email}`);
    const fields = { email, displayName, status: 'ACTIVE' as const, organizationId: organization.id, schoolId };
    const user = await prisma.user.upsert({
      where: { authUserId: data.user.id },
      create: { authUserId: data.user.id, ...fields },
      update: fields,
    });
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new Error(`Role "${roleName}" is missing; run npm run prisma:seed first`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    credentials.push(`${roleName.padEnd(14)} ${displayName.padEnd(18)} ${email.padEnd(28)} ${password}`);
    return user;
  };
  const ensureStaff = async (userId: string, employeeNo: string, designation: string) =>
    prisma.staffProfile.upsert({
      where: { userId },
      create: { userId, schoolId, employeeNo, designation },
      update: { schoolId, employeeNo, designation },
    });

  const adminUser = await ensureUser('admin', 'Sunita Rao', 'School Admin');
  const principalUser = await ensureUser('principal', 'Dr. Venkat Raman', 'Principal');
  const teacherUser = await ensureUser('teacher', 'Lavanya Devi', 'Teacher');
  const teacher2User = await ensureUser('teacher2', 'Suresh Babu', 'Teacher');
  await ensureStaff(adminUser.id, 'SPS-ADM-01', 'School Administrator');
  await ensureStaff(principalUser.id, 'SPS-PRN-01', 'Principal');
  const staffProfiles = {
    teacher: await ensureStaff(teacherUser.id, 'SPS-TCH-01', 'Class Teacher'),
    teacher2: await ensureStaff(teacher2User.id, 'SPS-TCH-02', 'Class Teacher'),
  };

  const year = await prisma.academicYear.upsert({
    where: { schoolId_name: { schoolId, name: '2026-27' } },
    create: {
      schoolId,
      name: '2026-27',
      startsOn: new Date('2026-04-01'),
      endsOn: new Date('2027-03-31'),
      isActive: true,
    },
    update: { isActive: true, isClosed: false },
  });
  const academicYearId = year.id;
  const subject = await prisma.subject.upsert({
    where: { schoolId_academicYearId_code: { schoolId, academicYearId, code: 'GEN' } },
    create: { schoolId, academicYearId, name: 'General Studies', code: 'GEN' },
    update: {},
  });

  // Students and their enrollments, section by section.
  const days = schoolDays(SCHOOL_DAYS);
  const today = days[days.length - 1];
  const namePool = [...FIRST_NAMES];
  const enrollmentsBySection: { id: string; studentId: string; index: number }[][] = [];
  let studentIndex = 0;
  for (const definition of SECTIONS) {
    const schoolClass = await prisma.schoolClass.upsert({
      where: {
        schoolId_academicYearId_name: { schoolId, academicYearId, name: definition.className },
      },
      create: { schoolId, academicYearId, name: definition.className, sortOrder: definition.sortOrder },
      update: { sortOrder: definition.sortOrder },
    });
    const section = await prisma.section.upsert({
      where: { classId_name: { classId: schoolClass.id, name: definition.name } },
      create: { schoolId, academicYearId, classId: schoolClass.id, name: definition.name },
      update: { isArchived: false },
    });
    const staffId = staffProfiles[definition.teacher].id;
    const assignment = await prisma.staffAssignment.findFirst({
      where: { staffId, classId: schoolClass.id, sectionId: section.id, subjectId: subject.id, academicYearId },
    });
    if (!assignment) {
      await prisma.staffAssignment.create({
        data: {
          schoolId,
          academicYearId,
          staffId,
          classId: schoolClass.id,
          sectionId: section.id,
          subjectId: subject.id,
          isClassTeacher: true,
        },
      });
    }

    const enrollments: { id: string; studentId: string; index: number }[] = [];
    for (let roll = 1; roll <= 14; roll += 1) {
      const firstName = namePool[studentIndex % namePool.length];
      const lastName = LAST_NAMES[studentIndex % LAST_NAMES.length];
      const number = String(studentIndex + 1).padStart(3, '0');
      const fields = {
        firstName,
        lastName,
        nfcId: `DEMO-NFC-${number}`,
        dateOfBirth: new Date(`${definition.sortOrder === 6 ? 2015 : 2014}-0${(studentIndex % 9) + 1}-15`),
      };
      const student = await prisma.student.upsert({
        where: { schoolId_admissionNo: { schoolId, admissionNo: `SPS-${number}` } },
        create: { schoolId, admissionNo: `SPS-${number}`, ...fields },
        update: { isArchived: false, ...fields },
      });
      const enrollmentFields = {
        classId: schoolClass.id,
        sectionId: section.id,
        rollNumber: String(roll),
        status: 'ACTIVE' as const,
      };
      const enrollment = await prisma.enrollment.upsert({
        where: { studentId_academicYearId: { studentId: student.id, academicYearId } },
        create: { schoolId, academicYearId, studentId: student.id, ...enrollmentFields },
        update: enrollmentFields,
      });
      enrollments.push({ id: enrollment.id, studentId: student.id, index: studentIndex });
      studentIndex += 1;
    }
    enrollmentsBySection.push(enrollments);

    // Attendance history. Section 6-A (the first) is left open today for the live demo.
    const markedById = definition.teacher === 'teacher' ? teacherUser.id : teacher2User.id;
    const openToday = definition === SECTIONS[0];
    await prisma.attendanceRecord.createMany({
      skipDuplicates: true,
      data: days
        .filter((date) => !(openToday && date.getTime() === today.getTime()))
        .flatMap((date, dayIndex) =>
          enrollments.map((enrollment) => ({
            schoolId,
            enrollmentId: enrollment.id,
            attendanceDate: date,
            status: statusFor(enrollment.index, dayIndex),
            markedById,
          })),
        ),
    });
  }

  // Student and parent logins, attached to the first two students of 6-A and the first of 6-B.
  const firstSection = enrollmentsBySection[0];
  const linkStudentLogin = async (key: string, roleName: string, studentId: string) => {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    const user = await ensureUser(key, `${student.firstName} ${student.lastName}`, roleName);
    await prisma.student.update({ where: { id: studentId }, data: { userId: user.id } });
    return user;
  };
  const studentUser = await linkStudentLogin('student', 'Student', firstSection[0].studentId);
  await linkStudentLogin('student2', 'Student', enrollmentsBySection[1][0].studentId);

  const parentUser = await ensureUser('parent', 'Ramesh Reddy', 'Parent');
  const guardian = await prisma.guardian.upsert({
    where: { userId: parentUser.id },
    create: { schoolId, userId: parentUser.id, name: 'Ramesh Reddy', relation: 'Father', email: parentUser.email },
    update: { schoolId, name: 'Ramesh Reddy', relation: 'Father' },
  });
  await prisma.studentGuardian.upsert({
    where: { studentId_guardianId: { studentId: firstSection[0].studentId, guardianId: guardian.id } },
    create: { studentId: firstSection[0].studentId, guardianId: guardian.id, isPrimary: true },
    update: { isPrimary: true },
  });

  // Published announcements and one leave request waiting for the class teacher.
  for (const announcement of ANNOUNCEMENTS) {
    const existing = await prisma.announcement.findFirst({ where: { schoolId, title: announcement.title } });
    if (!existing) {
      await prisma.announcement.create({
        data: {
          schoolId,
          ...announcement,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdById: principalUser.id,
        },
      });
    }
  }
  const pendingLeave = await prisma.studentLeave.findFirst({
    where: { schoolId, studentId: firstSection[0].studentId, status: 'PENDING' },
  });
  if (!pendingLeave) {
    const tomorrow = new Date(today.getTime() + DAY_MS);
    await prisma.studentLeave.create({
      data: {
        schoolId,
        studentId: firstSection[0].studentId,
        fromDate: tomorrow,
        toDate: tomorrow,
        reason: 'Family function out of town',
        requestedById: studentUser.id,
      },
    });
  }

  const file = resolve(process.cwd(), '..', 'demo-accounts.txt');
  writeFileSync(
    file,
    [
      `Demo school: ${school.name}  (generated ${new Date().toISOString()})`,
      '',
      ...credentials,
      '',
      'Card IDs for testing without a physical card: DEMO-NFC-001 to DEMO-NFC-014 are Class 6-A.',
      '',
    ].join('\n'),
  );
  console.log(`Demo school ready: ${studentIndex} students, ${days.length} school days.`);
  console.log(`Logins written to ${file}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
