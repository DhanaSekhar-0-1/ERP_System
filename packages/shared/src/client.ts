import type {
  AcademicYear,
  Announcement,
  ApprovalRequest,
  AttendanceRecord,
  AttendanceRisk,
  AttendanceStatus,
  AttendanceSummary,
  AttendanceWeek,
  AuthTokens,
  BulkResult,
  Child,
  ClassCard,
  ClassDetail,
  DefaultSubject,
  ExamSectionProgress,
  ExamType,
  MarkSheet,
  MyAssessment,
  MyTeaching,
  SectionAssignments,
  SectionEnrollment,
  ExamVerification,
  Examination,
  LeaveStatus,
  MySection,
  NfcScanResult,
  Paged,
  PrincipalDashboard,
  ReportCard,
  SchoolClass,
  Section,
  SectionSubject,
  AttendanceDashboardDay,
  DashboardSectionStudents,
  DeviceLocation,
  LeaveQuery,
  LeaveSession,
  StaffLeave,
  StaffLeaveType,
  StudentAttendanceProfile,
  Gender,
  RegisteredTeacher,
  StaffAttendanceDay,
  StaffAttendanceRecord,
  StaffAttendanceSettings,
  StaffAttendanceStatus,
  StaffAttendanceToday,
  Staff,
  StaffAssignment,
  SectionStudent,
  Student,
  StudentLeave,
  Subject,
  UserContext,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Where each app keeps the signed-in session: localStorage on web, SecureStore on mobile. */
export interface TokenStore {
  load(): Promise<AuthTokens | null>;
  save(tokens: AuthTokens | null): Promise<void>;
}

export interface ApiOptions {
  baseUrl: () => string;
  store: TokenStore;
  /** Called when the session can no longer be refreshed. */
  onSignedOut?: () => void;
}

interface Envelope<T> {
  data: T;
  meta: { total?: number; totalPages?: number };
  error: { message: string } | null;
}

interface SessionResponse {
  session: { access_token: string; refresh_token: string };
}

const query = (params: Record<string, string | number | undefined>) => {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  return pairs.length
    ? `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')}`
    : '';
};

export function createApi({ baseUrl, store, onSignedOut }: ApiOptions) {
  let refreshing: Promise<AuthTokens | null> | null = null;

  const send = async (method: string, path: string, body: unknown, token?: string) => {
    try {
      return await fetch(`${baseUrl()}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection.', 0);
    }
  };

  const toTokens = ({ session }: SessionResponse): AuthTokens => ({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });

  /** Concurrent 401s share one refresh, because refresh tokens are single-use. */
  const refresh = (tokens: AuthTokens) => {
    refreshing ??= (async () => {
      try {
        const response = await send('POST', '/auth/refresh', { refreshToken: tokens.refreshToken });
        if (!response.ok) return null;
        const next = toTokens(((await response.json()) as Envelope<SessionResponse>).data);
        await store.save(next);
        return next;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };

  /** Sends the request with the stored token, refreshing and retrying once after a 401. */
  const authorized = async (method: string, path: string, body?: unknown) => {
    const tokens = await store.load();
    const response = await send(method, path, body, tokens?.accessToken);
    if (response.status !== 401 || !tokens) return response;
    const next = await refresh(tokens);
    if (next) return send(method, path, body, next.accessToken);
    await store.save(null);
    onSignedOut?.();
    return response;
  };

  const envelope = async <T>(response: Response): Promise<Envelope<T>> => {
    let parsed: Envelope<T> | null = null;
    try {
      parsed = (await response.json()) as Envelope<T>;
    } catch {
      // Not JSON, for example a proxy error page.
    }
    if (!response.ok || !parsed) {
      throw new ApiError(parsed?.error?.message ?? 'The server returned an error', response.status);
    }
    return parsed;
  };

  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await envelope<T>(await authorized(method, path, body))).data;

  const list = async <T>(path: string): Promise<Paged<T>> => {
    const { data, meta } = await envelope<T[]>(await authorized('GET', path));
    return { items: data, total: meta.total ?? data.length, totalPages: meta.totalPages ?? 1 };
  };

  return {
    async login(identifier: string, password: string) {
      const response = await send('POST', '/auth/login', { identifier, password });
      const { data } = await envelope<SessionResponse>(response);
      await store.save(toTokens(data));
    },
    async logout() {
      await authorized('POST', '/auth/logout').catch(() => undefined);
      await store.save(null);
    },
    context: () => call<UserContext>('GET', '/auth/context'),
    changePassword: (currentPassword: string, newPassword: string) =>
      call<{ changed: boolean }>('POST', '/auth/change-password', { currentPassword, newPassword }),

    principalDashboard: () => call<PrincipalDashboard>('GET', '/dashboards/principal'),
    attendanceTrend: (from: string, to: string) =>
      call<AttendanceWeek[]>('GET', `/analytics/attendance${query({ from, to })}`),
    attendanceRisk: () => call<AttendanceRisk>('GET', '/analytics/attendance-risk'),

    mySections: (attendanceDate: string) =>
      call<MySection[]>('GET', `/attendance/my-sections${query({ attendanceDate })}`),
    sectionAttendance: (sectionId: string, attendanceDate: string) =>
      call<SectionStudent[]>('GET', `/sections/${sectionId}/attendance${query({ attendanceDate })}`),
    markBulk: (
      attendanceDate: string,
      records: { enrollmentId: string; status: AttendanceStatus }[],
      reason?: string,
    ) => call<BulkResult>('POST', '/attendance/bulk', { attendanceDate, records, reason }),
    nfcScan: (nfcId: string, attendanceDate: string, sectionId?: string) =>
      call<NfcScanResult>('POST', '/attendance/nfc-scan', { nfcId, attendanceDate, sectionId }),
    studentAttendance: (studentId: string, from: string, to: string) =>
      list<AttendanceRecord>(
        `/students/${studentId}/attendance${query({ from, to, limit: 100 })}`,
      ),
    attendanceSummary: (from: string, to: string, studentId?: string) =>
      call<AttendanceSummary>('GET', `/attendance/summary${query({ from, to, studentId })}`),
    async attendanceCsv(from: string, to: string) {
      const response = await authorized('GET', `/attendance/export${query({ from, to })}`);
      if (!response.ok) throw new ApiError('Unable to export attendance', response.status);
      return response.text();
    },

    students: (search: string, page: number) =>
      list<Student>(`/students${query({ search, page, limit: 20 })}`),
    assignCard: (studentId: string, nfcId: string) =>
      call<Student>('PATCH', `/students/${studentId}`, { nfcId }),

    announcements: () => call<Announcement[]>('GET', '/announcements'),

    studentLeaves: (status?: LeaveStatus) =>
      call<StudentLeave[]>('GET', `/student-leaves${query({ status })}`),
    requestLeave: (input: { studentId: string; fromDate: string; toDate: string; reason: string }) =>
      call<StudentLeave>('POST', '/student-leaves', input),
    decideLeave: (leaveId: string, decision: 'approve' | 'reject', note?: string) =>
      call<StudentLeave>('POST', `/student-leaves/${leaveId}/${decision}`, note ? { note } : {}),
    studentLeaveList: (filters: LeaveQuery = {}) =>
      call<StudentLeave[]>('GET', `/student-leaves${query({ ...filters })}`),

    staffLeaves: (filters: LeaveQuery = {}) => call<StaffLeave[]>('GET', `/staff-leaves${query({ ...filters })}`),
    requestStaffLeave: (input: {
      leaveType: StaffLeaveType;
      fromDate: string;
      toDate: string;
      session?: LeaveSession;
      reason: string;
    }) => call<StaffLeave>('POST', '/staff-leaves', input),
    decideStaffLeave: (leaveId: string, decision: 'approve' | 'reject', note?: string) =>
      call<StaffLeave>('POST', `/staff-leaves/${leaveId}/${decision}`, note ? { note } : {}),
    cancelStaffLeave: (leaveId: string) => call<StaffLeave>('POST', `/staff-leaves/${leaveId}/cancel`),

    approvals: () => list<ApprovalRequest>(`/approval-requests${query({ status: 'PENDING' })}`),
    decideApproval: (requestId: string, decision: 'approve' | 'reject') =>
      call<ApprovalRequest>('POST', `/approval-requests/${requestId}/${decision}`, {}),

    myChildren: () => call<Child[]>('GET', '/me/children'),

    classCards: (academicYearId: string) =>
      call<ClassCard[]>('GET', `/academics/classes${query({ academicYearId })}`),
    classDetail: (classId: string) => call<ClassDetail>('GET', `/academics/classes/${classId}`),
    createClass: (input: { academicYearId: string; name: string; sortOrder?: number }) =>
      call<SchoolClass>('POST', '/classes', input),
    updateClass: (classId: string, input: { name?: string; sortOrder?: number }) =>
      call<SchoolClass>('PATCH', `/classes/${classId}`, input),
    deleteClass: (classId: string) => call<unknown>('DELETE', `/academics/classes/${classId}`),
    createSection: (input: { academicYearId: string; classId: string; name: string }) =>
      call<Section>('POST', '/sections', input),
    renameSection: (sectionId: string, name: string) => call<Section>('PATCH', `/sections/${sectionId}`, { name }),
    deleteSection: (sectionId: string) => call<unknown>('DELETE', `/academics/sections/${sectionId}`),
    sectionStudents: (sectionId: string) =>
      call<SectionEnrollment[]>('GET', `/academics/sections/${sectionId}/students`),
    sectionSubjects: (sectionId: string) =>
      call<SectionSubject[]>('GET', `/academics/sections/${sectionId}/subjects`),
    addSectionSubject: (sectionId: string, input: { name: string; code?: string; isOptional?: boolean }) =>
      call<SectionSubject>('POST', `/academics/sections/${sectionId}/subjects`, input),
    updateSubject: (subjectId: string, input: { name?: string; code?: string; isOptional?: boolean; isEnabled?: boolean }) =>
      call<SectionSubject>('PATCH', `/academics/subjects/${subjectId}`, input),
    deleteSubject: (subjectId: string) => call<unknown>('DELETE', `/academics/subjects/${subjectId}`),
    setSubjectTeacher: (subjectId: string, staffId: string | null) =>
      call<unknown>('PUT', `/academics/subjects/${subjectId}/teacher`, staffId ? { staffId } : {}),
    setClassTeacher: (sectionId: string, staffId: string | null) =>
      call<unknown>('PUT', `/academics/sections/${sectionId}/class-teacher`, staffId ? { staffId } : {}),
    teacherAssignments: (academicYearId: string) =>
      call<SectionAssignments[]>('GET', `/academics/assignments${query({ academicYearId })}`),
    defaultSubjects: () => call<DefaultSubject[]>('GET', '/academics/default-subjects'),
    saveDefaultSubjects: (subjects: { name: string; code?: string; isOptional: boolean }[]) =>
      call<DefaultSubject[]>('PUT', '/academics/default-subjects', { subjects }),

    myTeaching: () => call<MyTeaching>('GET', '/academics/my-teaching'),
    myAssessments: () => call<MyAssessment[]>('GET', '/marks/my-assessments'),
    markSheet: (assessmentId: string) => call<MarkSheet>('GET', `/marks/sheet/${assessmentId}`),
    saveMarks: (
      assessmentId: string,
      marks: { studentId: string; marksObtained?: number; isAbsent?: boolean }[],
    ) => call<{ saved: number }>('POST', '/marks/bulk', { assessmentId, marks }),
    submitMarks: (assessmentId: string) => call<unknown>('POST', '/marks/submit', { assessmentId }),
    createSlipTest: (input: {
      name: string;
      classId: string;
      sectionId?: string;
      subjectId: string;
      maxMarks: number;
      passMarks?: number;
      examDate?: string;
    }) => call<Examination>('POST', '/examinations/slip-tests', input),

    academicYears: () => call<AcademicYear[]>('GET', '/academic-years'),
    classes: (academicYearId: string) => call<SchoolClass[]>('GET', `/classes${query({ academicYearId })}`),
    sections: (classId: string) => call<Section[]>('GET', `/sections${query({ classId })}`),
    subjects: (academicYearId: string) => call<Subject[]>('GET', `/subjects${query({ academicYearId })}`),

    staff: () => call<Staff[]>('GET', '/staff'),
    createTeacher: (input: {
      displayName: string;
      phone: string;
      joiningDate: string;
      teachingSubjects: string[];
      gender?: Gender;
      dateOfBirth?: string;
      email?: string;
      address?: string;
      nfcId?: string;
    }) => call<RegisteredTeacher>('POST', '/staff', input),
    teachingSubjects: () => call<string[]>('GET', '/staff/teaching-subjects'),

    myAttendanceToday: () => call<StaffAttendanceToday>('GET', '/staff-attendance/me/today'),
    checkIn: (location: DeviceLocation) => call<StaffAttendanceRecord>('POST', '/staff-attendance/check-in', location),
    checkOut: (location: DeviceLocation) => call<StaffAttendanceRecord>('POST', '/staff-attendance/check-out', location),
    staffAttendanceDay: (date?: string) => call<StaffAttendanceDay>('GET', `/staff-attendance${query({ date })}`),
    correctStaffAttendance: (
      staffId: string,
      input: { date: string; status: StaffAttendanceStatus; checkInTime?: string; checkOutTime?: string; reason: string },
    ) => call<StaffAttendanceRecord>('PUT', `/staff-attendance/${staffId}`, input),
    staffAttendanceSettings: () => call<StaffAttendanceSettings>('GET', '/staff-attendance/settings'),
    attendanceDashboard: (date?: string) => call<AttendanceDashboardDay>('GET', `/attendance-dashboard${query({ date })}`),
    attendanceDashboardSection: (sectionId: string, date?: string) =>
      call<DashboardSectionStudents>('GET', `/attendance-dashboard/sections/${sectionId}${query({ date })}`),
    studentAttendanceProfile: (studentId: string) =>
      call<StudentAttendanceProfile>('GET', `/attendance-dashboard/students/${studentId}`),
    saveStaffAttendanceSettings: (input: Partial<Pick<StaffAttendanceSettings, 'latitude' | 'longitude' | 'radiusMeters' | 'lateAfter'>>) =>
      call<StaffAttendanceSettings>('PUT', '/staff-attendance/settings', input),
    staffAssignments: (academicYearId: string) =>
      call<StaffAssignment[]>('GET', `/staff-assignments${query({ academicYearId })}`),
    assignTeacher: (
      staffId: string,
      input: { academicYearId: string; classId: string; sectionId?: string; subjectId: string; isClassTeacher: boolean },
    ) => call<StaffAssignment>('POST', `/staff/${staffId}/assignments`, input),
    removeAssignment: (assignmentId: string) =>
      call<unknown>('DELETE', `/staff-assignments/${assignmentId}`),

    examinations: (academicYearId: string) =>
      call<Examination[]>('GET', `/examinations${query({ academicYearId })}`),
    createExamination: (input: { academicYearId: string; type: ExamType; name?: string; startsOn?: string; endsOn?: string }) =>
      call<Examination>('POST', '/examinations', input),
    addAssessment: (examinationId: string, input: { classId: string; subjectId: string; maxMarks: number; passMarks?: number }) =>
      call<unknown>('POST', `/examinations/${examinationId}/assessments`, input),
    examSections: (examinationId: string) =>
      call<ExamSectionProgress>('GET', `/examinations/${examinationId}/sections`),
    sectionAction: (examinationId: string, sectionId: string, action: 'verify' | 'release' | 'reject') =>
      call<{ sectionId: string; name: string; status: string; examReleased: boolean }>('POST', `/examinations/${examinationId}/sections/${sectionId}/${action}`, {}),
    approveReadySections: (examinationId: string) =>
      call<{ approved: { sectionId: string; name: string }[]; waiting: { name: string; status: string; missing: number }[] }>('POST', `/examinations/${examinationId}/sections/verify-ready`, {}),
    releaseApprovedSections: (examinationId: string) =>
      call<{ released: { sectionId: string; name: string }[]; waiting: { name: string; status: string; missing: number }[] }>('POST', `/examinations/${examinationId}/sections/release-approved`, {}),
    reportCards: (studentId: string) => call<ReportCard[]>('GET', `/students/${studentId}/report-cards`),
    examVerification: (examinationId: string) =>
      call<ExamVerification>('GET', `/examinations/${examinationId}/verification`),
    addClassSubjects: (examinationId: string, input: { classIds: string[]; maxMarks: number; passMarks?: number }) =>
      call<{ added: number; skipped: number; classes: number }>('POST', `/examinations/${examinationId}/assessments/class`, input),
    examAction: (examinationId: string, action: 'verify' | 'reject' | 'release') =>
      call<Examination>('POST', `/examinations/${examinationId}/${action}`, {}),
  };
}

export type Api = ReturnType<typeof createApi>;
