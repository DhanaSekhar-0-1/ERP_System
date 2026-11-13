/** Response shapes of the backend routes the apps use. */

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE' | 'EXCUSED';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserContext {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  school: { id: string; name: string } | null;
  staffId: string | null;
  studentId: string | null;
  guardianId: string | null;
  /** Still on a generated first password: the apps show only the choose-a-new-password screen. */
  mustChangePassword: boolean;
  /** The school's module switches; a module missing here is on. */
  modules?: Partial<Record<SchoolModuleKey, boolean>>;
}

export type SchoolModuleKey =
  | 'exams'
  | 'announcements'
  | 'homework'
  | 'fees'
  | 'timetable'
  | 'transport'
  | 'library'
  | 'assets'
  | 'complaints'
  | 'certificates'
  | 'parentLogin';

/** True unless the user's school has switched this module off. */
export function moduleOn(user: Pick<UserContext, 'modules'> | null | undefined, key: SchoolModuleKey): boolean {
  return user?.modules?.[key] !== false;
}

/** GET/PUT /school-modules: which parts of the app the school uses, and the registration switches. */
export interface SchoolModulesView {
  states: Record<SchoolModuleKey, boolean>;
  modules: { key: SchoolModuleKey; label: string; description: string; enabled: boolean; inMvp1: boolean }[];
  registration: { requireAadhaar: boolean; requireNfcCard: boolean };
}

export interface StudentName {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
}

export interface Student extends StudentName {
  nfcId: string | null;
  phone: string | null;
  isArchived: boolean;
}

export interface AttendanceRecord {
  id: string;
  attendanceDate: string;
  status: AttendanceStatus;
  remarks: string | null;
  source: string;
  enrollment: {
    id: string;
    rollNumber: string | null;
    student: StudentName;
    class: { id: string; name: string };
    section: { id: string; name: string };
  };
  markedBy: { id: string; displayName: string } | null;
}

export interface MySection {
  id: string;
  name: string;
  class: { id: string; name: string };
  students: number;
  marked: number;
  attended: number;
}

export interface SectionStudent {
  enrollmentId: string;
  rollNumber: string | null;
  student: StudentName;
  attendance: { id: string; status: AttendanceStatus; source: string } | null;
}

export interface BulkResult {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  results: { enrollmentId: string; result: string; error?: string }[];
}

export interface NfcScanResult {
  result: 'marked' | 'already_marked';
  record: AttendanceRecord;
}

export interface PrincipalDashboard {
  date: string;
  students: number;
  activeStaff: number;
  attendanceToday: Partial<Record<AttendanceStatus, number>> & { marked: number; rate: number | null };
  staffOnLeaveToday: number;
  pendingApprovals: number;
  pendingStudentLeaves: number;
}

export interface AttendanceWeek {
  weekOf: string;
  total: number;
  present: number;
  rate: number;
}

export interface AttendanceRisk {
  threshold: number;
  students: {
    enrollmentId: string;
    total: number;
    present: number;
    rate: number;
    student?: StudentName;
    class?: { name: string };
    section?: { name: string };
  }[];
}

export interface AttendanceSummary {
  totals: Partial<Record<AttendanceStatus, number>>;
  recorded: number;
  attendanceRate: number | null;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface StudentLeave {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: LeaveStatus;
  decisionNote: string | null;
  student: { id: string; firstName: string; lastName: string | null; admissionNo?: string };
}

export type StaffLeaveType = 'CASUAL' | 'SICK' | 'EARNED' | 'UNPAID';
/** Full day, or the morning or afternoon half of a single day. */
export type LeaveSession = 'FULL_DAY' | 'MORNING' | 'AFTERNOON';

export interface StaffLeave {
  id: string;
  leaveType: StaffLeaveType;
  fromDate: string;
  toDate: string;
  /** School days covered; 0.5 for a half day. */
  days: number;
  session: LeaveSession;
  reason: string;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  staff: { id: string; employeeNo: string; user: { id: string; displayName: string } };
}

/** Filters for leave lists; `from`/`to` keep leave that overlaps the window. */
export interface LeaveQuery {
  status?: LeaveStatus;
  from?: string;
  to?: string;
  staffId?: string;
  studentId?: string;
}

export interface ApprovalRequest {
  id: string;
  type: string;
  entityType: string;
  reason: string;
  tier: number;
  status: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  requester?: { displayName: string };
}

export interface Child {
  id: string;
  firstName: string;
  lastName: string | null;
  enrollments: { class: { name: string }; section: { name: string } }[];
}

export interface AcademicYear {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  isClosed: boolean;
}

export interface SchoolClass {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Section {
  id: string;
  name: string;
  classId: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
}

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export interface Staff {
  id: string;
  /** For teachers registered from MVP1 on, the app-made Teacher ID (e.g. T26A05). */
  employeeNo: string;
  /** Older staff only; newer teachers have teachingSubjects instead. */
  designation: string | null;
  nfcId: string | null;
  joiningDate: string | null;
  gender: Gender | null;
  /** Subjects the teacher can teach; the first is the main one. */
  teachingSubjects: string[];
  user: { id: string; email: string; displayName: string; phone: string | null; status: string };
}

/** Returned once when a teacher is registered: the login and the first password to hand over. */
export interface RegisteredTeacher extends Staff {
  teacherId: string;
  loginId: string;
  firstPassword: string;
  mustChangePassword: boolean;
}

export interface StaffAssignment {
  id: string;
  staffId: string;
  isClassTeacher: boolean;
  class: { id: string; name: string };
  section: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string | null };
  academicYear: { id: string; name: string };
}

export type ExamType = 'FA1' | 'FA2' | 'FA3' | 'FA4' | 'Q1' | 'Q2' | 'Q3' | 'PRE_PUBLIC' | 'SLIP_TEST' | 'OTHER';
export type ExamStatus = 'DRAFT' | 'VERIFIED' | 'LOCKED' | 'RELEASED';

export interface Examination {
  id: string;
  name: string;
  type: ExamType;
  status: ExamStatus;
  term: string | null;
  startsOn: string | null;
  endsOn: string | null;
  academicYearId: string;
  _count?: { assessments: number };
}

export interface ExamVerification {
  examinationId: string;
  status: ExamStatus;
  missing: number;
  unsubmitted: number;
  assessments: {
    assessmentId: string;
    class: { id: string; name: string };
    section: { id: string; name: string } | null;
    subject: { id: string; name: string };
    enrolled: number;
    entered: number;
    submitted: number;
    complete: boolean;
  }[];
}

export interface StaffSummary {
  staffId: string;
  employeeNo: string;
  displayName: string;
}

export interface ClassCard {
  id: string;
  name: string;
  sortOrder: number;
  academicYearId: string;
  sections: number;
  subjects: number;
  teachers: number;
  students: number;
}

export interface SectionSubject {
  id: string;
  name: string;
  code: string;
  isOptional: boolean;
  isEnabled: boolean;
  teachers: (StaffSummary & { assignmentId: string })[];
}

export interface ClassDetail {
  id: string;
  name: string;
  sortOrder: number;
  academicYearId: string;
  sections: {
    id: string;
    name: string;
    students: number;
    classTeacher: StaffSummary | null;
    subjects: SectionSubject[];
  }[];
}

export interface SectionAssignments {
  sectionId: string;
  sectionName: string;
  class: { id: string; name: string };
  classTeacher: StaffSummary | null;
  subjects: { subjectId: string; name: string; isOptional: boolean; teacher: StaffSummary | null }[];
}

export interface DefaultSubject {
  name: string;
  code: string;
  isOptional: boolean;
}

export interface SectionEnrollment {
  id: string;
  rollNumber: string | null;
  student: StudentName;
}

export interface MyTeaching {
  academicYear: { id: string; name: string } | null;
  subjects: {
    assignmentId: string;
    class: { id: string; name: string };
    section: { id: string; name: string } | null;
    subject: { id: string; name: string; code: string };
    students: number | null;
  }[];
  classTeacherOf: { section: { id: string; name: string }; class: { id: string; name: string }; students: number }[];
}

export interface MyAssessment {
  id: string;
  examination: { id: string; name: string; type: ExamType; status: ExamStatus };
  class: { id: string; name: string };
  section: { id: string; name: string } | null;
  subject: { id: string; name: string };
  maxMarks: number;
  passMarks: number | null;
  students: number | null;
  entered: number;
  submitted: number;
  /** DRAFT: waiting for marks; VERIFIED: admin approved; RELEASED: visible to families. */
  status: ExamStatus;
}

export interface ExamSectionRow {
  section: { id: string; name: string };
  class: { id: string; name: string };
  subjects: number;
  students: number;
  expected: number;
  entered: number;
  submitted: number;
  missing: number;
  complete: boolean;
  status: ExamStatus;
  verifiedAt: string | null;
  releasedAt: string | null;
}

export interface ExamSectionProgress {
  examinationId: string;
  type: ExamType;
  status: ExamStatus;
  sections: ExamSectionRow[];
}

export interface ReportCard {
  examination: { id: string; name: string; term: string | null };
  subjects: { subject: { id: string; name: string }; maxMarks: number; marksObtained: number | null; isAbsent: boolean; percent: number; grade: string; passed: boolean }[];
  total: number;
  maxTotal: number;
  percent: number;
  grade: string;
  result: string;
}

export interface MarkSheet {
  assessment: {
    id: string;
    examination: { id: string; name: string; type: ExamType; status: ExamStatus };
    class: { id: string; name: string };
    section: { id: string; name: string } | null;
    subject: { id: string; name: string };
    maxMarks: number;
    passMarks: number | null;
  };
  students: {
    student: StudentName;
    section: string;
    rollNumber: string | null;
    mark: { id: string; marksObtained: number | null; isAbsent: boolean; status: 'DRAFT' | 'SUBMITTED' } | null;
  }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  totalPages: number;
}

export type StaffAttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ON_LEAVE';

/** One teacher's day; times are school-local HH:MM. */
export interface StaffAttendanceRecord {
  id: string;
  date: string;
  status: StaffAttendanceStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  minutesAtSchool: number | null;
  checkInDistanceM: number | null;
  checkOutDistanceM: number | null;
  corrected: boolean;
  correctionReason: string | null;
}

/** What the teacher's phone shows for today. */
export interface StaffAttendanceToday {
  date: string;
  record: StaffAttendanceRecord | null;
  onLeave: boolean;
  /** MORNING or AFTERNOON when the teacher has an approved half day today. */
  halfDayLeave: 'MORNING' | 'AFTERNOON' | null;
  lateAfter: string;
  radiusMeters: number;
  locationReady: boolean;
}

export interface StaffAttendanceSettings {
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  lateAfter: string;
  locationReady: boolean;
}

/** One row of the school's teacher attendance for a day. */
export interface StaffAttendanceRow {
  staffId: string;
  teacherId: string;
  name: string;
  phone: string | null;
  subjects: string[];
  status: StaffAttendanceStatus | 'NOT_CHECKED_IN';
  record: StaffAttendanceRecord | null;
  leaveType: string | null;
  leaveSession: LeaveSession | null;
}

export interface StaffAttendanceDay {
  date: string;
  isToday: boolean;
  lateAfter: string;
  summary: { total: number; present: number; late: number; onLeave: number; absent: number; notCheckedIn: number };
  teachers: StaffAttendanceRow[];
}

/** Where the device says it is; only the distance from school is stored. */
export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** Counts of marked days; percent leaves out leave and excused days (null when nothing counted). */
export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  excused: number;
  percent: number | null;
}

export interface DashboardSection extends AttendanceCounts {
  sectionId: string;
  classId: string;
  label: string;
  className: string;
  sectionName: string;
  students: number;
  marked: number;
  notMarked: number;
}

export interface AttendanceDashboardDay {
  date: string;
  summary: AttendanceCounts & { students: number; marked: number; notMarked: number };
  sections: DashboardSection[];
}

export interface DashboardSectionStudents {
  date: string;
  sectionId: string;
  label: string;
  students: {
    studentId: string;
    name: string;
    admissionNo: string;
    rollNumber: string | null;
    status: AttendanceStatus | null;
    year: AttendanceCounts;
  }[];
}

export interface StudentAttendanceProfile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  admissionDate: string | null;
  admissionType: 'NEW_TO_SCHOOL' | 'EXISTING' | null;
  bloodGroup: string | null;
  address: string | null;
  nfcId: string | null;
  aadhaarMasked: string | null;
  aadhaarEnrolmentNo: string | null;
  isArchived: boolean;
  guardians: { isPrimary: boolean; guardian: { name: string; phone: string | null; relation: string | null } }[];
  years: {
    academicYear: { id: string; name: string; isActive: boolean };
    label: string;
    rollNumber: string | null;
    status: string;
    overall: AttendanceCounts;
    months: (AttendanceCounts & { month: string })[];
  }[];
}

