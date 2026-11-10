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
