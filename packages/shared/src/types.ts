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

export interface Paged<T> {
  items: T[];
  total: number;
  totalPages: number;
}
