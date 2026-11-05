import type {
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
  LeaveStatus,
  MySection,
  NfcScanResult,
  Paged,
  PrincipalDashboard,
  SectionStudent,
  Student,
  StudentLeave,
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
    decideLeave: (leaveId: string, decision: 'approve' | 'reject') =>
      call<StudentLeave>('POST', `/student-leaves/${leaveId}/${decision}`, {}),

    approvals: () => list<ApprovalRequest>(`/approval-requests${query({ status: 'PENDING' })}`),
    decideApproval: (requestId: string, decision: 'approve' | 'reject') =>
      call<ApprovalRequest>('POST', `/approval-requests/${requestId}/${decision}`, {}),

    myChildren: () => call<Child[]>('GET', '/me/children'),
  };
}

export type Api = ReturnType<typeof createApi>;
