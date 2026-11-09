import type { ExamStatus, ExamType, Examination } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Plus, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useActiveYear } from '../hooks';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';
import { Dialog, Field } from '../components/Dialog';

const TYPE_LABELS: Record<ExamType, string> = {
  FA1: 'FA1 (minor)',
  FA2: 'FA2 (minor)',
  FA3: 'FA3 (minor)',
  FA4: 'FA4 (minor)',
  Q1: 'Q1 Quarterly (major)',
  Q2: 'Q2 Half-yearly (major)',
  Q3: 'Q3 Annual (major)',
  PRE_PUBLIC: 'Pre-public (Class 10)',
  SLIP_TEST: 'Slip test',
  OTHER: 'Other',
};

const CREATABLE: ExamType[] = ['FA1', 'FA2', 'FA3', 'FA4', 'Q1', 'Q2', 'Q3', 'PRE_PUBLIC', 'OTHER'];

const STATUS: Record<ExamStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Waiting for marks', className: 'bg-slate-100 text-slate-700' },
  VERIFIED: { label: 'Admin approved', className: 'bg-amber-100 text-amber-800' },
  LOCKED: { label: 'Admin approved', className: 'bg-amber-100 text-amber-800' },
  RELEASED: { label: 'Released', className: 'bg-emerald-100 text-emerald-800' },
};

function CreateExamDialog({ yearId, onClose }: { yearId: string; onClose(): void }) {
  const client = useQueryClient();
  const [type, setType] = useState<ExamType>('FA1');
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.createExamination({
        academicYearId: yearId,
        type,
        name: name.trim() || undefined,
        startsOn: startsOn || undefined,
        endsOn: endsOn || undefined,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['exams'] });
      onClose();
    },
  });

  return (
    <Dialog
      title="Create an exam"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={create.isPending} className={buttonClass}>{create.isPending ? 'Saving…' : 'Create exam'}</button>
        </>
      }
    >
      <Field label="Exam type">
        <select value={type} onChange={(event) => setType(event.target.value as ExamType)} className={inputClass}>
          {CREATABLE.map((item) => <option key={item} value={item}>{TYPE_LABELS[item]}</option>)}
        </select>
      </Field>
      <Field label={type === 'OTHER' ? 'Name' : 'Name (optional, defaults to the type)'}>
        <input required={type === 'OTHER'} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts on">
          <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Ends on">
          <input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} className={inputClass} />
        </Field>
      </div>
      <p className="text-xs text-muted">Teachers create slip tests themselves for their own classes.</p>
      {create.isError && <p role="alert" className="text-sm font-medium text-red-600">{errorText(create.error)}</p>}
    </Dialog>
  );
}

function AddSubjectDialog({ exam, onClose }: { exam: Examination; onClose(): void }) {
  const client = useQueryClient();
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [maxMarks, setMaxMarks] = useState('');
  const [passMarks, setPassMarks] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [wholeClass, setWholeClass] = useState(true);
  const classes = useQuery({ queryKey: ['classes', exam.academicYearId], queryFn: () => api.classes(exam.academicYearId) });
  const sections = useQuery({ queryKey: ['sections', classId], queryFn: () => api.sections(classId), enabled: Boolean(classId) && !wholeClass });
  const subjects = useQuery({ queryKey: ['section-subjects', sectionId], queryFn: () => api.sectionSubjects(sectionId), enabled: Boolean(sectionId) && !wholeClass });
  const add = useMutation({
    mutationFn: async () => {
      const marks = { maxMarks: Number(maxMarks), passMarks: passMarks ? Number(passMarks) : undefined };
      if (wholeClass) return api.addClassSubjects(exam.id, { classId, ...marks });
      return api.addAssessment(exam.id, { classId, subjectId, ...marks });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['exams'] });
      await client.invalidateQueries({ queryKey: ['verification', exam.id] });
      onClose();
    },
  });

  return (
    <Dialog
      title={`Add a subject to ${exam.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={add.isPending} className={buttonClass}>{add.isPending ? 'Saving…' : wholeClass ? 'Add all subjects' : 'Add subject'}</button>
        </>
      }
    >
      <div role="radiogroup" aria-label="What to add" className="grid gap-2 sm:grid-cols-2">
        {[
          { value: true, label: 'Whole class', hint: 'Every subject that is on, in every section' },
          { value: false, label: 'One subject', hint: 'A single subject of one section' },
        ].map((option) => (
          <label key={option.label} className={'cursor-pointer rounded-xl border p-3 text-sm ' + (wholeClass === option.value ? 'border-brand bg-brand-soft' : 'border-line')}>
            <input type="radio" name="add-mode" className="sr-only" checked={wholeClass === option.value} onChange={() => setWholeClass(option.value)} />
            <span className="block font-bold">{option.label}</span>
            <span className="text-xs text-muted">{option.hint}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Class">
          <select required value={classId} onChange={(event) => { setClassId(event.target.value); setSectionId(''); setSubjectId(''); }} className={inputClass}>
            <option value="">Choose a class</option>
            {classes.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        {!wholeClass && (
          <Field label="Section">
            <select required value={sectionId} disabled={!classId} onChange={(event) => { setSectionId(event.target.value); setSubjectId(''); }} className={inputClass}>
              <option value="">Choose a section</option>
              {sections.data?.map((item) => <option key={item.id} value={item.id}>Section {item.name}</option>)}
            </select>
          </Field>
        )}
        {!wholeClass && (
          <Field label="Subject">
            <select required value={subjectId} disabled={!sectionId} onChange={(event) => setSubjectId(event.target.value)} className={inputClass}>
              <option value="">Choose a subject</option>
              {subjects.data?.filter((item) => item.isEnabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Maximum marks">
          <input required type="number" min={1} step="0.5" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Pass marks (optional)">
          <input type="number" min={0} step="0.5" value={passMarks} onChange={(event) => setPassMarks(event.target.value)} className={inputClass} />
        </Field>
      </div>
      {add.isError && <p role="alert" className="text-sm font-medium text-red-600">{errorText(add.error)}</p>}
    </Dialog>
  );
}

function ExamRow({ exam, onAddSubject }: { exam: Examination; onAddSubject(exam: Examination): void }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const isAdmin = roles.includes('School Admin') || roles.includes('Super Admin');
  const isPrincipal = roles.includes('Principal') || roles.includes('Super Admin');
  const slipTest = exam.type === 'SLIP_TEST';
  const approved = exam.status === 'VERIFIED' || exam.status === 'LOCKED';
  const verification = useQuery({
    queryKey: ['verification', exam.id],
    queryFn: () => api.examVerification(exam.id),
    enabled: open && permissions.includes('marks:verify'),
  });
  const act = useMutation({
    mutationFn: (action: 'verify' | 'reject' | 'release') => api.examAction(exam.id, action),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['exams'] });
      await client.invalidateQueries({ queryKey: ['verification', exam.id] });
    },
  });
  const status = STATUS[exam.status];
  const ready = verification.data ? verification.data.missing === 0 && verification.data.unsubmitted === 0 : true;

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-52 flex-1 items-center gap-2 text-left">
          <ChevronDown className={`size-4 text-muted transition ${open ? '' : '-rotate-90'}`} aria-hidden />
          <span>
            <span className="block font-bold">{exam.name}</span>
            <span className="text-xs text-muted">
              {TYPE_LABELS[exam.type]} · {exam._count?.assessments ?? 0} subject(s)
            </span>
          </span>
        </button>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${status.className}`}>{status.label}</span>
        <div className="flex flex-wrap gap-2">
          {exam.status === 'DRAFT' && permissions.includes('examinations:manage') && !slipTest && (
            <button onClick={() => onAddSubject(exam)} className={ghostButtonClass}>
              <Plus className="size-4" aria-hidden /> Subject
            </button>
          )}
          {exam.status === 'DRAFT' && isAdmin && Boolean(exam._count?.assessments) && (
            <button disabled={act.isPending} onClick={() => act.mutate('verify')} className={buttonClass}>
              <CheckCircle2 className="size-4" aria-hidden /> {slipTest ? 'Approve and release' : 'Approve marks'}
            </button>
          )}
          {approved && isPrincipal && !slipTest && (
            <button disabled={act.isPending} onClick={() => act.mutate('release')} className={buttonClass}>
              <Send className="size-4" aria-hidden /> Final approval and release
            </button>
          )}
          {approved && permissions.includes('marks:verify') && (
            <button disabled={act.isPending} onClick={() => act.mutate('reject')} className={ghostButtonClass}>
              <Undo2 className="size-4" aria-hidden /> Send back
            </button>
          )}
        </div>
      </div>
      {act.isError && <p role="alert" className="mt-2 text-sm font-medium text-red-600">{errorText(act.error)}</p>}
      {open && (
        <div className="mt-3 rounded-xl bg-page p-3">
          {verification.isLoading && <p className="text-sm text-muted">Loading marks progress…</p>}
          {verification.isError && <p className="text-sm text-red-600">{errorText(verification.error)}</p>}
          {verification.data?.assessments.length === 0 && <p className="text-sm text-muted">No subjects added yet.</p>}
          {verification.data && verification.data.assessments.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Class</th>
                  <th className="pb-2">Subject</th>
                  <th className="pb-2">Marks entered</th>
                  <th className="pb-2">Submitted by teacher</th>
                </tr>
              </thead>
              <tbody>
                {verification.data.assessments.map((row) => (
                  <tr key={row.assessmentId} className="border-t border-line">
                    <td className="py-2">{row.section ? `${row.class.name}-${row.section.name}` : row.class.name}</td>
                    <td className="py-2">{row.subject.name}</td>
                    <td className="py-2">{row.entered} / {row.enrolled}</td>
                    <td className={`py-2 font-semibold ${row.complete ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {row.submitted} / {row.enrolled}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {exam.status === 'DRAFT' && !ready && (
            <p className="mt-2 text-xs text-muted">Marks can be approved once every teacher has entered and submitted them.</p>
          )}
        </div>
      )}
    </li>
  );
}

export function ExamsPage() {
  const { user } = useAuth();
  const { year, loading } = useActiveYear();
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<Examination | null>(null);
  const exams = useQuery({ queryKey: ['exams', year?.id], queryFn: () => api.examinations(year!.id), enabled: Boolean(year) });
  const canCreate = Boolean(user?.permissions.includes('examinations:manage'));
  const groups: { title: string; filter(exam: Examination): boolean }[] = [
    { title: 'Major exams', filter: (exam) => ['Q1', 'Q2', 'Q3', 'PRE_PUBLIC'].includes(exam.type) },
    { title: 'Minor exams', filter: (exam) => ['FA1', 'FA2', 'FA3', 'FA4'].includes(exam.type) },
    { title: 'Slip tests', filter: (exam) => exam.type === 'SLIP_TEST' },
    { title: 'Other exams', filter: (exam) => exam.type === 'OTHER' },
  ];

  return (
    <>
      <PageHeader
        title="Exams"
        subtitle="Teachers submit marks, the School Admin approves them, and the Principal gives final approval. Slip tests need only the School Admin."
        action={
          canCreate && year && (
            <button onClick={() => setCreating(true)} className={buttonClass}>
              <Plus className="size-4" aria-hidden /> Create exam
            </button>
          )
        }
      />
      {!year && !loading && <Message>No active academic year.</Message>}
      {exams.isLoading && <Message>Loading exams…</Message>}
      {exams.isError && <Message tone="error">{errorText(exams.error)}</Message>}
      {exams.data?.length === 0 && <Message>No exams yet for {year?.name}.</Message>}
      <div className="grid gap-4">
        {groups.map(({ title, filter }) => {
          const items = exams.data?.filter(filter) ?? [];
          if (!items.length) return null;
          return (
            <Card key={title} title={title}>
              <ul className="-my-4 divide-y divide-line">
                {items.map((exam) => <ExamRow key={exam.id} exam={exam} onAddSubject={setAdding} />)}
              </ul>
            </Card>
          );
        })}
      </div>
      {creating && year && <CreateExamDialog yearId={year.id} onClose={() => setCreating(false)} />}
      {adding && <AddSubjectDialog exam={adding} onClose={() => setAdding(null)} />}
    </>
  );
}
