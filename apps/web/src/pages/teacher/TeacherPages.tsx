import type { AttendanceStatus, MarkSheet } from '@erp/shared';
import { fullName, isoDate } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, ClipboardList, Send, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Field, FormError } from '../../components/Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader, StatusBadge } from '../../components/ui';

/** The teacher's own subjects and class-teacher sections, from their active assignments. */
export function MyClassesPage() {
  const teaching = useQuery({ queryKey: ['my-teaching'], queryFn: api.myTeaching });
  const data = teaching.data;
  return (
    <>
      <PageHeader title="My classes" subtitle={data?.academicYear ? `Your subjects and sections for ${data.academicYear.name}` : 'Your subjects and sections'} />
      {teaching.isLoading && <Message>Loading…</Message>}
      {teaching.isError && <Message tone="error">{errorText(teaching.error)}</Message>}
      {data && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card title="Subjects I teach">
            {data.subjects.length === 0 && <Message>No subjects assigned yet. Ask the School Admin.</Message>}
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.subjects.map((item) => (
                <li key={item.assignmentId} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><BookOpen className="size-5" aria-hidden /></span>
                  <span>
                    <span className="block font-bold">{item.subject.name}</span>
                    <span className="text-sm text-muted">
                      {item.class.name}{item.section ? `-${item.section.name}` : ' (all sections)'}
                      {item.students !== null ? ` · ${item.students} students` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Class teacher of">
            {data.classTeacherOf.length === 0 && <p className="text-sm text-muted">You are not a class teacher this year.</p>}
            <ul className="grid gap-2">
              {data.classTeacherOf.map((item) => (
                <li key={item.section.id} className="flex items-center gap-3 rounded-xl bg-brand-soft p-3">
                  <UserCheck className="size-5 text-brand" aria-hidden />
                  <span className="font-bold text-brand">{item.class.name}-{item.section.name}</span>
                  <span className="ml-auto text-sm text-muted">{item.students} students</span>
                </li>
              ))}
            </ul>
            {data.classTeacherOf.length > 0 && (
              <Link to="/attendance" className={`${ghostButtonClass} mt-3 w-full`}>Mark today’s attendance</Link>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

const CHOICES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE'];

/** Daily attendance for the sections where the teacher is class teacher. */
export function TeacherAttendancePage() {
  const client = useQueryClient();
  const [date, setDate] = useState(isoDate());
  const sections = useQuery({ queryKey: ['my-sections', date], queryFn: () => api.mySections(date) });
  const [sectionId, setSectionId] = useState('');
  const current = sectionId || sections.data?.[0]?.id || '';
  const rows = useQuery({ queryKey: ['section-attendance', current, date], queryFn: () => api.sectionAttendance(current, date), enabled: Boolean(current) });
  const [choices, setChoices] = useState<Record<string, AttendanceStatus>>({});
  const [reason, setReason] = useState('');
  useEffect(() => setChoices({}), [current, date]);
  const changes = (rows.data ?? []).filter((row) => choices[row.enrollmentId] && choices[row.enrollmentId] !== row.attendance?.status);
  const needsReason = changes.some((row) => row.attendance);
  const save = useMutation({
    mutationFn: () => api.markBulk(date, changes.map((row) => ({ enrollmentId: row.enrollmentId, status: choices[row.enrollmentId] })), needsReason ? reason.trim() : undefined),
    onSuccess: async () => {
      setChoices({});
      setReason('');
      await client.invalidateQueries({ queryKey: ['section-attendance'] });
      await client.invalidateQueries({ queryKey: ['my-sections'] });
    },
  });
  const markAllPresent = () => {
    const next: Record<string, AttendanceStatus> = {};
    rows.data?.forEach((row) => { if (!row.attendance) next[row.enrollmentId] = 'PRESENT'; });
    setChoices((existing) => ({ ...existing, ...next }));
  };

  return (
    <>
      <PageHeader title="Attendance" subtitle="Class teachers mark daily attendance for their own sections." />
      {sections.isLoading && <Message>Loading…</Message>}
      {sections.isError && <Message tone="error">{errorText(sections.error)}</Message>}
      {sections.data?.length === 0 && <Message>You are not class teacher of any section, so you have no attendance to mark.</Message>}
      {Boolean(sections.data?.length) && (
        <Card>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="Section">
              <select value={current} onChange={(event) => setSectionId(event.target.value)} className={inputClass}>
                {sections.data?.map((item) => <option key={item.id} value={item.id}>{item.class.name}-{item.name} ({item.marked}/{item.students} marked)</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" max={isoDate()} value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
            </Field>
            <button onClick={markAllPresent} className={ghostButtonClass}>Mark the rest present</button>
          </div>
          {rows.isLoading && <Message>Loading students…</Message>}
          <ul className="divide-y divide-line">
            {rows.data?.map((row) => {
              const chosen = choices[row.enrollmentId] ?? row.attendance?.status;
              return (
                <li key={row.enrollmentId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-10 text-sm text-muted">{row.rollNumber ?? '—'}</span>
                  <span className="min-w-40 flex-1 font-semibold">{fullName(row.student)}</span>
                  {row.attendance && !choices[row.enrollmentId] && <StatusBadge status={row.attendance.status} />}
                  <div role="radiogroup" aria-label={`Attendance for ${fullName(row.student)}`} className="flex gap-1">
                    {CHOICES.map((status) => (
                      <button
                        key={status}
                        role="radio"
                        aria-checked={chosen === status}
                        onClick={() => setChoices((existing) => ({ ...existing, [row.enrollmentId]: status }))}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold ${chosen === status ? 'bg-ink text-white' : 'border border-line bg-white'}`}
                      >
                        {status[0] + status.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {needsReason && (
            <Field label="Reason for changing saved attendance">
              <input required value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} />
            </Field>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button disabled={!changes.length || save.isPending || (needsReason && !reason.trim())} onClick={() => save.mutate()} className={buttonClass}>
              {save.isPending ? 'Saving…' : `Save ${changes.length || ''} change(s)`}
            </button>
            {save.isSuccess && <span role="status" className="text-sm font-semibold text-emerald-700">Saved</span>}
          </div>
          <FormError error={save.error} />
        </Card>
      )}
    </>
  );
}

const MARK_STATE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Waiting for marks', className: 'bg-slate-100 text-slate-700' },
  VERIFIED: { label: 'Approved by admin', className: 'bg-amber-100 text-amber-800' },
  RELEASED: { label: 'Results released', className: 'bg-emerald-100 text-emerald-800' },
};

/** Exam subjects in the teacher's own classes: still open for marks, approved, and released. */
export function MarksListPage() {
  const assessments = useQuery({ queryKey: ['my-assessments'], queryFn: api.myAssessments });
  const groups = [
    { title: 'Waiting for your marks', items: assessments.data?.filter((item) => item.status === 'DRAFT') ?? [] },
    { title: 'Approved, waiting for release', items: assessments.data?.filter((item) => item.status === 'VERIFIED' || item.status === 'LOCKED') ?? [] },
    { title: 'Results released', items: assessments.data?.filter((item) => item.status === 'RELEASED') ?? [] },
  ];
  return (
    <>
      <PageHeader title="Marks entry" subtitle="Exams and slip tests for your own subjects. Released results are visible to students and parents." />
      {assessments.isLoading && <Message>Loading…</Message>}
      {assessments.isError && <Message tone="error">{errorText(assessments.error)}</Message>}
      {assessments.data?.length === 0 && <Message>No exams for your subjects yet.</Message>}
      {groups.filter((group) => group.items.length).map((group) => (
        <section key={group.title} className="mb-6">
          <h2 className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">{group.title}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {group.items.map((item) => {
              const done = item.students !== null && item.submitted >= item.students && item.students > 0;
              const state = MARK_STATE[item.status] ?? MARK_STATE.DRAFT;
              return (
                <Link key={item.id} to={`/marks/${item.id}`} className="rounded-2xl border border-line bg-white p-4 shadow-sm hover:border-brand">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block font-bold">{item.examination.name}</span>
                      <span className="text-sm text-muted">{item.subject.name} · {item.class.name}{item.section ? `-${item.section.name}` : ''} · out of {item.maxMarks}</span>
                    </span>
                    {item.status === 'DRAFT' && (done ? <CheckCircle2 className="size-5 text-emerald-600" aria-label="Submitted" /> : <ClipboardList className="size-5 text-muted" aria-hidden />)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${state.className}`}>{state.label}</span>
                    <span className="text-xs text-muted">{item.entered} entered · {item.submitted} submitted{item.students !== null ? ` of ${item.students}` : ''}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

type Entry = { marks: string; absent: boolean };

/** Enter, save and submit marks for one exam subject. */
export function MarkSheetPage() {
  const { assessmentId = '' } = useParams();
  const client = useQueryClient();
  const sheet = useQuery({ queryKey: ['mark-sheet', assessmentId], queryFn: () => api.markSheet(assessmentId) });
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  useEffect(() => {
    if (!sheet.data) return;
    const next: Record<string, Entry> = {};
    sheet.data.students.forEach((row) => {
      next[row.student.id] = { marks: row.mark?.marksObtained?.toString() ?? '', absent: row.mark?.isAbsent ?? false };
    });
    setEntries(next);
  }, [sheet.data]);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['mark-sheet', assessmentId] });
    await client.invalidateQueries({ queryKey: ['my-assessments'] });
  };
  const editable = (row: MarkSheet['students'][number]) => row.mark?.status !== 'SUBMITTED';
  const saveMarks = () =>
      api.saveMarks(
        assessmentId,
        (sheet.data?.students ?? [])
          .filter((row) => editable(row))
          .map((row) => ({ row, entry: entries[row.student.id] }))
          .filter(({ entry }) => entry && (entry.absent || entry.marks !== ''))
          .map(({ row, entry }) => (entry.absent ? { studentId: row.student.id, isAbsent: true } : { studentId: row.student.id, marksObtained: Number(entry.marks) })),
      );
  const save = useMutation({ mutationFn: saveMarks, onSuccess: refresh });
  // Submitting always saves what is on screen first, so nothing typed is lost.
  const submit = useMutation({
    mutationFn: async () => {
      await saveMarks();
      return api.submitMarks(assessmentId);
    },
    onSuccess: refresh,
  });
  const busy = save.isPending || submit.isPending;
  const data = sheet.data;
  const allSubmitted = data ? data.students.length > 0 && data.students.every((row) => row.mark?.status === 'SUBMITTED') : false;

  return (
    <>
      <Link to="/marks" className="mb-3 inline-block text-sm font-semibold text-muted hover:text-ink">← All exams</Link>
      <PageHeader
        title={data ? `${data.assessment.examination.name} · ${data.assessment.subject.name}` : 'Marks'}
        subtitle={data ? `${data.assessment.class.name}${data.assessment.section ? `-${data.assessment.section.name}` : ''} · out of ${data.assessment.maxMarks}${data.assessment.passMarks !== null ? `, pass ${data.assessment.passMarks}` : ''}` : undefined}
      />
      {sheet.isLoading && <Message>Loading…</Message>}
      {sheet.isError && <Message tone="error">{errorText(sheet.error)}</Message>}
      {data && (
        <Card>
          {data.students.length === 0 && <Message>No students in this class.</Message>}
          <ul className="divide-y divide-line">
            {data.students.map((row) => {
              const entry = entries[row.student.id] ?? { marks: '', absent: false };
              const locked = !editable(row);
              return (
                <li key={row.student.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-14 text-sm text-muted">{row.section}{row.rollNumber ? ` · ${row.rollNumber}` : ''}</span>
                  <span className="min-w-40 flex-1 font-semibold">{fullName(row.student)}</span>
                  <input
                    aria-label={`Marks for ${fullName(row.student)}`}
                    type="number"
                    min={0}
                    max={data.assessment.maxMarks}
                    step="0.5"
                    disabled={locked || entry.absent}
                    value={entry.marks}
                    onChange={(event) => setEntries((all) => ({ ...all, [row.student.id]: { ...entry, marks: event.target.value } }))}
                    className={`${inputClass} w-24 py-1.5`}
                  />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" aria-label={`${fullName(row.student)} absent`} disabled={locked} checked={entry.absent} onChange={(event) => setEntries((all) => ({ ...all, [row.student.id]: { ...entry, absent: event.target.checked } }))} className="size-4" />
                    Absent
                  </label>
                  {locked && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">Submitted</span>}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => save.mutate()} disabled={busy || allSubmitted} className={ghostButtonClass}>{save.isPending ? 'Saving…' : 'Save draft'}</button>
            <button onClick={() => submit.mutate()} disabled={busy || allSubmitted} className={buttonClass}>
              <Send className="size-4" aria-hidden /> {allSubmitted ? 'Submitted for approval' : 'Submit for approval'}
            </button>
            {save.isSuccess && !save.isPending && <span role="status" className="text-sm font-semibold text-emerald-700">Saved</span>}
          </div>
          <p className="mt-2 text-xs text-muted">Submitting saves your marks and sends them for approval. After that, changes need a correction request.</p>
          <FormError error={save.error ?? submit.error} />
        </Card>
      )}
    </>
  );
}

/** A slip test for one of the teacher's own classes and subjects. */
export function SlipTestPage() {
  const client = useQueryClient();
  const teaching = useQuery({ queryKey: ['my-teaching'], queryFn: api.myTeaching });
  const [assignmentId, setAssignmentId] = useState('');
  const [name, setName] = useState('');
  const [maxMarks, setMaxMarks] = useState('20');
  const [examDate, setExamDate] = useState(isoDate());
  const assignment = teaching.data?.subjects.find((item) => item.assignmentId === assignmentId);
  const create = useMutation({
    mutationFn: () =>
      api.createSlipTest({
        name: name.trim(),
        classId: assignment!.class.id,
        sectionId: assignment!.section?.id,
        subjectId: assignment!.subject.id,
        maxMarks: Number(maxMarks),
        examDate,
      }),
    onSuccess: async () => {
      setName('');
      await client.invalidateQueries({ queryKey: ['my-assessments'] });
    },
  });
  return (
    <>
      <PageHeader title="Slip tests" subtitle="Create a short test for your own subject. After you submit marks, the School Admin approves and releases them." />
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
          className="grid max-w-xl gap-4"
        >
          <Field label="Class and subject">
            <select required value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)} className={inputClass}>
              <option value="">Choose one of your subjects</option>
              {teaching.data?.subjects.filter((item) => item.section).map((item) => (
                <option key={item.assignmentId} value={item.assignmentId}>{item.class.name}-{item.section?.name} · {item.subject.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Test name">
            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fractions slip test 1" className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Maximum marks">
              <input required type="number" min={1} value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Date">
              <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button disabled={create.isPending || !assignment} className={buttonClass}>{create.isPending ? 'Creating…' : 'Create slip test'}</button>
            {create.isSuccess && <Link to="/marks" className="text-sm font-semibold text-brand">Created – enter marks</Link>}
          </div>
          <FormError error={create.error} />
        </form>
      </Card>
    </>
  );
}
