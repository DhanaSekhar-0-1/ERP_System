import type { LeaveSession, LeaveStatus, StaffLeave, StaffLeaveType, StudentLeave } from '@erp/shared';
import { isoDate, shortDate } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Dialog, Field, FormError } from '../components/Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

const TYPE: Record<StaffLeaveType, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid' };
const SESSION: Record<LeaveSession, string> = { FULL_DAY: '', MORNING: 'Morning half', AFTERNOON: 'Afternoon half' };
const STATUS: Record<LeaveStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-page text-muted',
};
const STATUS_LABEL: Record<LeaveStatus, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

function Status({ status }: { status: LeaveStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** "12 Nov", "12–14 Nov", or "12 Nov · Morning half". */
function when(leave: { fromDate: string; toDate: string; session?: LeaveSession }) {
  const from = leave.fromDate.slice(0, 10);
  const to = leave.toDate.slice(0, 10);
  const range = from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;
  return leave.session && leave.session !== 'FULL_DAY' ? `${range} · ${SESSION[leave.session]}` : range;
}

const days = (leave: StaffLeave) => (leave.days === 0.5 ? '½ day' : `${leave.days} day${leave.days === 1 ? '' : 's'}`);
const studentName = (leave: StudentLeave) => [leave.student.firstName, leave.student.lastName].filter(Boolean).join(' ');

/** Approve, or reject with a reason (required for teacher leave). */
function DecideDialog({ title, requireReason, onDecide, onClose }: {
  title: string;
  requireReason: boolean;
  onDecide(note: string): Promise<unknown>;
  onClose(): void;
}) {
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => onDecide(note.trim()), onSuccess: onClose });
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={save.isPending} className={`${buttonClass} bg-red-600 hover:bg-red-700`}>{save.isPending ? 'Saving…' : 'Reject'}</button>
        </>
      }
    >
      <Field label={requireReason ? 'Reason (the teacher will see it)' : 'Reason (optional)'}>
        <input required={requireReason} minLength={requireReason ? 3 : undefined} maxLength={300} autoFocus value={note} onChange={(event) => setNote(event.target.value)} className={inputClass} />
      </Field>
      <FormError error={save.error} />
    </Dialog>
  );
}

// ---------- School leaders ----------

/** Principal decides teacher leave; Admin and Super Admin see requests and who is away. */
export function LeaderLeavePage() {
  const { user } = useAuth();
  const isPrincipal = Boolean(user?.roles.includes('Principal'));
  const client = useQueryClient();
  const today = isoDate();
  const [rejecting, setRejecting] = useState<StaffLeave | null>(null);
  const pending = useQuery({ queryKey: ['staff-leaves', 'PENDING'], queryFn: () => api.staffLeaves({ status: 'PENDING' }) });
  const awayStaff = useQuery({ queryKey: ['staff-leaves', 'away', today], queryFn: () => api.staffLeaves({ status: 'APPROVED', from: today }) });
  const awayStudents = useQuery({ queryKey: ['student-leaves', 'away', today], queryFn: () => api.studentLeaveList({ status: 'APPROVED', from: today }) });
  const studentRequests = useQuery({ queryKey: ['student-leaves', 'PENDING'], queryFn: () => api.studentLeaveList({ status: 'PENDING' }) });
  const refresh = () => client.invalidateQueries({ queryKey: ['staff-leaves'] });
  const approve = useMutation({ mutationFn: (id: string) => api.decideStaffLeave(id, 'approve'), onSuccess: refresh });

  return (
    <>
      <PageHeader title="Leave" subtitle={isPrincipal ? 'Decide teacher leave and see who is away' : 'Requests and who is away'} />
      <div className="grid gap-6">
        <Card title="Teacher leave requests">
          {!isPrincipal && <p className="mb-3 text-sm text-muted">Only the Principal approves or rejects teacher leave.</p>}
          {pending.isLoading && <Message>Loading…</Message>}
          {pending.isError && <Message tone="error">{errorText(pending.error)}</Message>}
          {pending.data?.length === 0 && <Message>No requests waiting.</Message>}
          <ul className="divide-y divide-line">
            {pending.data?.map((leave) => (
              <li key={leave.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-56 flex-1">
                  <p className="font-semibold">{leave.staff.user.displayName} <span className="text-xs font-normal text-muted">{leave.staff.employeeNo}</span></p>
                  <p className="text-sm text-muted">{TYPE[leave.leaveType]} · {when(leave)} · {days(leave)}</p>
                  <p className="text-sm">“{leave.reason}”</p>
                </div>
                {isPrincipal && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setRejecting(leave)} className={ghostButtonClass}>Reject</button>
                    <button type="button" disabled={approve.isPending} onClick={() => approve.mutate(leave.id)} className={buttonClass}>Approve</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <FormError error={approve.error} />
        </Card>

        <Card title="On leave today and coming days">
          {(awayStaff.isLoading || awayStudents.isLoading) && <Message>Loading…</Message>}
          {awayStaff.isError && <Message tone="error">{errorText(awayStaff.error)}</Message>}
          {awayStaff.data?.length === 0 && awayStudents.data?.length === 0 && <Message>Nobody is on approved leave from today.</Message>}
          <div className="grid gap-6 lg:grid-cols-2">
            {Boolean(awayStaff.data?.length) && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-muted">Teachers</h3>
                <ul className="divide-y divide-line text-sm">
                  {awayStaff.data?.map((leave) => (
                    <li key={leave.id} className="py-2">
                      <span className="font-semibold">{leave.staff.user.displayName}</span> · {when(leave)}
                      <span className="block text-xs text-muted">{TYPE[leave.leaveType]} · {days(leave)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Boolean(awayStudents.data?.length) && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-muted">Students</h3>
                <ul className="divide-y divide-line text-sm">
                  {awayStudents.data?.map((leave) => (
                    <li key={leave.id} className="py-2">
                      <span className="font-semibold">{studentName(leave)}</span> · {when(leave)}
                      <span className="block text-xs text-muted">{leave.student.admissionNo} · “{leave.reason}”</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>

        <Card title="Student leave waiting for class teachers">
          <p className="mb-3 text-sm text-muted">Class teachers decide student leave.</p>
          {studentRequests.data?.length === 0 && <Message>No student requests waiting.</Message>}
          <ul className="divide-y divide-line text-sm">
            {studentRequests.data?.map((leave) => (
              <li key={leave.id} className="py-2">
                <span className="font-semibold">{studentName(leave)}</span> · {when(leave)} · “{leave.reason}”
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {rejecting && (
        <DecideDialog
          title={`Reject leave for ${rejecting.staff.user.displayName}`}
          requireReason
          onDecide={async (note) => {
            await api.decideStaffLeave(rejecting.id, 'reject', note);
            await refresh();
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  );
}

// ---------- Teachers ----------

function RequestLeaveCard() {
  const client = useQueryClient();
  const [form, setForm] = useState({ leaveType: 'CASUAL' as StaffLeaveType, fromDate: isoDate(), toDate: isoDate(), session: 'FULL_DAY' as LeaveSession, reason: '' });
  const [sent, setSent] = useState(false);
  const single = form.fromDate === form.toDate;
  const save = useMutation({
    mutationFn: () =>
      api.requestStaffLeave({
        leaveType: form.leaveType,
        fromDate: form.fromDate,
        toDate: form.toDate,
        session: single ? form.session : 'FULL_DAY',
        reason: form.reason.trim(),
      }),
    onSuccess: async () => {
      setSent(true);
      setForm((current) => ({ ...current, reason: '' }));
      await client.invalidateQueries({ queryKey: ['my-staff-leaves'] });
    },
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setSent(false);
    setForm((current) => {
      const next = { ...current, [key]: event.target.value };
      if (key === 'fromDate' && next.toDate < next.fromDate) next.toDate = next.fromDate;
      return next;
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <Card title="Request leave">
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">
            <select value={form.leaveType} onChange={set('leaveType')} className={inputClass}>
              {(Object.keys(TYPE) as StaffLeaveType[]).map((type) => <option key={type} value={type}>{TYPE[type]}</option>)}
            </select>
          </Field>
          <Field label="From">
            <input type="date" required min={isoDate()} value={form.fromDate} onChange={set('fromDate')} className={inputClass} />
          </Field>
          <Field label="To">
            <input type="date" required min={form.fromDate} value={form.toDate} onChange={set('toDate')} className={inputClass} />
          </Field>
        </div>
        {single && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1.5 text-sm font-semibold">How much of the day</legend>
            {(['FULL_DAY', 'MORNING', 'AFTERNOON'] as LeaveSession[]).map((session) => (
              <label key={session} className="flex items-center gap-2">
                <input type="radio" name="session" checked={form.session === session} onChange={() => setForm((current) => ({ ...current, session }))} />
                {session === 'FULL_DAY' ? 'Full day' : session === 'MORNING' ? 'Morning half' : 'Afternoon half'}
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Reason">
          <input required minLength={3} maxLength={300} value={form.reason} onChange={set('reason')} className={inputClass} placeholder="For example: family function" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={save.isPending} className={buttonClass}>{save.isPending ? 'Sending…' : 'Send to Principal'}</button>
          {sent && <span role="status" className="text-sm font-semibold text-emerald-700">Sent. The Principal will decide.</span>}
        </div>
        <FormError error={save.error} />
      </form>
    </Card>
  );
}

function MyLeaveCard() {
  const { user } = useAuth();
  const client = useQueryClient();
  const mine = useQuery({
    queryKey: ['my-staff-leaves'],
    queryFn: () => api.staffLeaves({ staffId: user?.staffId ?? undefined }),
    enabled: Boolean(user?.staffId),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelStaffLeave(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-staff-leaves'] }),
  });
  return (
    <Card title="My leave">
      {mine.isLoading && <Message>Loading…</Message>}
      {mine.isError && <Message tone="error">{errorText(mine.error)}</Message>}
      {mine.data?.length === 0 && <Message>No leave requests yet.</Message>}
      <ul className="divide-y divide-line">
        {mine.data?.map((leave) => (
          <li key={leave.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <div className="min-w-56 flex-1">
              <p className="font-semibold">{TYPE[leave.leaveType]} · {when(leave)} <span className="font-normal text-muted">· {days(leave)}</span></p>
              <p className="text-muted">“{leave.reason}”</p>
              {leave.decisionNote && <p className="mt-0.5">Principal: {leave.decisionNote}</p>}
            </div>
            <Status status={leave.status} />
            {leave.status === 'PENDING' && (
              <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(leave.id)} className="text-xs font-bold text-red-600 hover:underline">
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
      <FormError error={cancel.error} />
    </Card>
  );
}

/** Student leave for the teacher's classes: the class teacher approves or rejects. */
function StudentRequestsCard() {
  const client = useQueryClient();
  const [rejecting, setRejecting] = useState<StudentLeave | null>(null);
  const requests = useQuery({ queryKey: ['student-leaves', 'PENDING'], queryFn: () => api.studentLeaveList({ status: 'PENDING' }) });
  const refresh = () => client.invalidateQueries({ queryKey: ['student-leaves'] });
  const approve = useMutation({ mutationFn: (id: string) => api.decideLeave(id, 'approve'), onSuccess: refresh });
  return (
    <Card title="Student leave requests">
      {requests.isLoading && <Message>Loading…</Message>}
      {requests.isError && <Message tone="error">{errorText(requests.error)}</Message>}
      {requests.data?.length === 0 && <Message>No student requests waiting.</Message>}
      <ul className="divide-y divide-line">
        {requests.data?.map((leave) => (
          <li key={leave.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <div className="min-w-56 flex-1">
              <p className="font-semibold">{studentName(leave)} <span className="text-xs font-normal text-muted">{leave.student.admissionNo}</span></p>
              <p className="text-muted">{when(leave)} · “{leave.reason}”</p>
            </div>
            <button type="button" onClick={() => setRejecting(leave)} className={ghostButtonClass}>Reject</button>
            <button type="button" disabled={approve.isPending} onClick={() => approve.mutate(leave.id)} className={buttonClass}>Approve</button>
          </li>
        ))}
      </ul>
      <FormError error={approve.error} />
      {rejecting && (
        <DecideDialog
          title={`Reject leave for ${studentName(rejecting)}`}
          requireReason={false}
          onDecide={async (note) => {
            await api.decideLeave(rejecting.id, 'reject', note || undefined);
            await refresh();
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </Card>
  );
}

export function TeacherLeavePage() {
  return (
    <>
      <PageHeader title="Leave" subtitle="Ask the Principal for leave, and decide your students' requests" />
      <div className="grid gap-6">
        <RequestLeaveCard />
        <MyLeaveCard />
        <StudentRequestsCard />
      </div>
    </>
  );
}
