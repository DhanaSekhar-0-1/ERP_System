import type { StaffAttendanceRow, StaffAttendanceStatus } from '@erp/shared';
import { daysAgo, isoDate, shortDate } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Dialog, Field, FormError } from '../components/Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader, StatusBadge } from '../components/ui';

function saveCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value}%`);

const TEACHER_STATUS: Record<StaffAttendanceRow['status'], { label: string; className: string }> = {
  PRESENT: { label: 'Present', className: 'bg-emerald-50 text-emerald-700' },
  LATE: { label: 'Late', className: 'bg-amber-50 text-amber-700' },
  ABSENT: { label: 'Absent', className: 'bg-red-50 text-red-700' },
  ON_LEAVE: { label: 'On leave', className: 'bg-sky-50 text-sky-700' },
  NOT_CHECKED_IN: { label: 'Not checked in', className: 'bg-page text-muted' },
};

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

/** The School Admin marks or changes a teacher's day, with a reason. */
function CorrectTeacherDialog({ row, date, onClose }: { row: StaffAttendanceRow; date: string; onClose(): void }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<StaffAttendanceStatus>(row.status === 'NOT_CHECKED_IN' ? 'PRESENT' : row.status);
  const [checkIn, setCheckIn] = useState(row.record?.checkInTime ?? '');
  const [checkOut, setCheckOut] = useState(row.record?.checkOutTime ?? '');
  const [reason, setReason] = useState('');
  const attended = status === 'PRESENT' || status === 'LATE';
  const save = useMutation({
    mutationFn: () =>
      api.correctStaffAttendance(row.staffId, {
        date,
        status,
        checkInTime: attended && checkIn ? checkIn : undefined,
        checkOutTime: attended && checkOut ? checkOut : undefined,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['staff-attendance-day'] });
      onClose();
    },
  });
  return (
    <Dialog
      title={`Correct ${row.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={save.isPending} className={buttonClass}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <p className="text-sm text-muted">{row.teacherId} · {shortDate(date)}. The reason is kept with the record.</p>
      <Field label="Status">
        <select value={status} onChange={(event) => setStatus(event.target.value as StaffAttendanceStatus)} className={inputClass}>
          <option value="PRESENT">Present</option>
          <option value="LATE">Late</option>
          <option value="ABSENT">Absent</option>
          <option value="ON_LEAVE">On leave</option>
        </select>
      </Field>
      {attended && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Check-in time">
            <input type="time" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Check-out time">
            <input type="time" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} className={inputClass} />
          </Field>
        </div>
      )}
      <Field label="Reason">
        <input required minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: forgot phone at home" className={inputClass} />
      </Field>
      <FormError error={save.error} />
    </Dialog>
  );
}

function TeachersToday({ date }: { date: string }) {
  const { user } = useAuth();
  const canCorrect = Boolean(user?.permissions.includes('staff-attendance:manage'));
  const [correcting, setCorrecting] = useState<StaffAttendanceRow | null>(null);
  const day = useQuery({ queryKey: ['staff-attendance-day', date], queryFn: () => api.staffAttendanceDay(date) });
  const summary = day.data?.summary;
  return (
    <Card title={day.data?.isToday === false ? `Teachers on ${shortDate(date)}` : 'Teachers today'}>
      {day.isLoading && <Message>Loading…</Message>}
      {day.isError && <Message tone="error">{errorText(day.error)}</Message>}
      {summary && (
        <p className="mb-3 text-sm text-muted">
          {summary.present} present · {summary.late} late · {summary.onLeave} on leave ·{' '}
          {day.data?.isToday ? `${summary.notCheckedIn} not checked in yet` : `${summary.absent} absent`} · late after {day.data?.lateAfter}
        </p>
      )}
      {day.data?.teachers.length === 0 && <Message>No teachers registered yet.</Message>}
      {Boolean(day.data?.teachers.length) && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="pb-2 font-semibold">Teacher</th>
                <th className="pb-2 font-semibold">Status</th>
                <th className="pb-2 font-semibold">In</th>
                <th className="pb-2 font-semibold">Out</th>
                <th className="pb-2 font-semibold">Note</th>
                {canCorrect && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody>
              {day.data?.teachers.map((row) => {
                const status = TEACHER_STATUS[row.status];
                return (
                  <tr key={row.staffId} className="border-t border-line">
                    <td className="py-2.5">
                      <span className="font-semibold">{row.name}</span>
                      <span className="block text-xs text-muted">{row.teacherId} · {row.subjects.join(', ') || '—'}</span>
                    </td>
                    <td className="py-2.5">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${status.className}`}>{status.label}</span>
                    </td>
                    <td className="py-2.5 tabular-nums">{row.record?.checkInTime ?? '—'}</td>
                    <td className="py-2.5 tabular-nums">{row.record?.checkOutTime ?? '—'}</td>
                    <td className="py-2.5 text-xs text-muted">
                      {row.leaveSession === 'MORNING' ? 'Half day (morning) ' : row.leaveSession === 'AFTERNOON' ? 'Half day (afternoon) ' : ''}
                      {row.record?.corrected ? `Corrected: ${row.record.correctionReason}` : ''}
                    </td>
                    {canCorrect && (
                      <td className="py-2.5 text-right">
                        <button type="button" onClick={() => setCorrecting(row)} className="rounded-lg px-2 py-1 text-xs font-bold text-brand hover:bg-brand-soft">
                          Correct
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {correcting && <CorrectTeacherDialog row={correcting} date={date} onClose={() => setCorrecting(null)} />}
    </Card>
  );
}

function SectionStudents({ sectionId, date }: { sectionId: string; date: string }) {
  const students = useQuery({
    queryKey: ['dashboard-section', sectionId, date],
    queryFn: () => api.attendanceDashboardSection(sectionId, date),
  });
  return (
    <Card title={students.data ? `${students.data.label} students` : 'Students'}>
      {students.isLoading && <Message>Loading…</Message>}
      {students.isError && <Message tone="error">{errorText(students.error)}</Message>}
      {students.data?.students.length === 0 && <Message>No students in this section.</Message>}
      {Boolean(students.data?.students.length) && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="pb-2 font-semibold">Roll</th>
                <th className="pb-2 font-semibold">Student</th>
                <th className="pb-2 font-semibold">On {shortDate(date)}</th>
                <th className="pb-2 font-semibold">This year</th>
              </tr>
            </thead>
            <tbody>
              {students.data?.students.map((row) => (
                <tr key={row.studentId} className="border-t border-line">
                  <td className="py-2.5 text-muted">{row.rollNumber ?? '—'}</td>
                  <td className="py-2.5">
                    <Link to={`/students/${row.studentId}`} className="font-semibold text-brand hover:underline">{row.name}</Link>
                    <span className="block text-xs text-muted">{row.admissionNo}</span>
                  </td>
                  <td className="py-2.5">{row.status ? <StatusBadge status={row.status} /> : <span className="text-muted">Not marked</span>}</td>
                  <td className="py-2.5 tabular-nums">
                    <span className={`font-bold ${row.year.percent !== null && row.year.percent < 75 ? 'text-red-600' : ''}`}>{pct(row.year.percent)}</span>
                    <span className="block text-xs text-muted">{row.year.present + row.year.late} of {row.year.present + row.year.late + row.year.absent} days</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The Admin attendance dashboard (MVP1): students by class and section, and teachers, for a day. */
export function AttendancePage() {
  const [date, setDate] = useState(isoDate());
  const [classFilter, setClassFilter] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [exportError, setExportError] = useState('');
  const day = useQuery({ queryKey: ['attendance-dashboard', date], queryFn: () => api.attendanceDashboard(date) });
  const classes = [...new Map(day.data?.sections.map((s) => [s.classId, s.className]) ?? []).entries()];
  const sections = day.data?.sections.filter((s) => !classFilter || s.classId === classFilter) ?? [];
  const summary = day.data?.summary;

  const exportCsv = async () => {
    setExportError('');
    const from = daysAgo(30);
    const to = isoDate();
    try {
      saveCsv(await api.attendanceCsv(from, to), `attendance-${from}-to-${to}.csv`);
    } catch (error) {
      setExportError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={date === isoDate() ? 'Today across the school' : `On ${shortDate(date)}`}
        action={
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" aria-label="Date" max={isoDate()} value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
            <button className={buttonClass} onClick={() => void exportCsv()}>
              <Download className="size-4" aria-hidden /> Export last 30 days
            </button>
          </div>
        }
      />
      {exportError && <Message tone="error">{exportError}</Message>}
      {day.isError && <Message tone="error">{errorText(day.error)}</Message>}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Attendance" value={pct(summary.percent)} />
          <Tile label="Present" value={summary.present + summary.late} tone="text-emerald-700" />
          <Tile label="Absent" value={summary.absent} tone="text-red-600" />
          <Tile label="On leave" value={summary.onLeave} tone="text-sky-700" />
          <Tile label="Not marked yet" value={summary.notMarked} tone="text-amber-700" />
        </div>
      )}
      <div className="grid gap-6">
        <TeachersToday date={date} />
        <Card title="Students by class and section">
          <div className="mb-4 flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Class
              <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setSectionId(''); }} className={inputClass}>
                <option value="">All classes</option>
                {classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
          {day.isLoading && <Message>Loading…</Message>}
          {day.data && sections.length === 0 && <Message>No sections in the active year.</Message>}
          {sections.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="pb-2 font-semibold">Section</th>
                    <th className="pb-2 font-semibold">Students</th>
                    <th className="pb-2 font-semibold">Present</th>
                    <th className="pb-2 font-semibold">Absent</th>
                    <th className="pb-2 font-semibold">On leave</th>
                    <th className="pb-2 font-semibold">Not marked</th>
                    <th className="pb-2 font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((row) => (
                    <tr
                      key={row.sectionId}
                      onClick={() => setSectionId(row.sectionId)}
                      className={`cursor-pointer border-t border-line hover:bg-page ${row.sectionId === sectionId ? 'bg-brand-soft' : ''}`}
                    >
                      <td className="py-2.5">
                        <button type="button" onClick={() => setSectionId(row.sectionId)} className="font-semibold text-brand hover:underline">{row.label}</button>
                      </td>
                      <td className="py-2.5 tabular-nums">{row.students}</td>
                      <td className="py-2.5 tabular-nums text-emerald-700">{row.present + row.late}</td>
                      <td className="py-2.5 tabular-nums text-red-600">{row.absent}</td>
                      <td className="py-2.5 tabular-nums text-sky-700">{row.onLeave}</td>
                      <td className={`py-2.5 tabular-nums ${row.notMarked ? 'font-bold text-amber-700' : 'text-muted'}`}>{row.notMarked}</td>
                      <td className="py-2.5 font-bold tabular-nums">{pct(row.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!sectionId && sections.length > 0 && <p className="mt-3 text-xs text-muted">Choose a section to see its students and their attendance for the year.</p>}
        </Card>
        {sectionId && <SectionStudents sectionId={sectionId} date={date} />}
      </div>
    </>
  );
}
