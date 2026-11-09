import type { ExamStatus, ExamType, Examination } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Plus, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useActiveYear } from '../hooks';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';
import { ClassMultiSelect } from '../components/ClassMultiSelect';
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
  const [classIds, setClassIds] = useState<string[]>([]);
  const [maxMarks, setMaxMarks] = useState('');
  const [passMarks, setPassMarks] = useState('');
  const classes = useQuery({ queryKey: ['classes', yearId], queryFn: () => api.classes(yearId) });
  const create = useMutation({
    mutationFn: async () => {
      const exam = await api.createExamination({
        academicYearId: yearId,
        type,
        name: name.trim() || undefined,
        startsOn: startsOn || undefined,
        endsOn: endsOn || undefined,
      });
      if (classIds.length) {
        await api.addClassSubjects(exam.id, {
          classIds,
          maxMarks: Number(maxMarks),
          passMarks: passMarks ? Number(passMarks) : undefined,
        });
      }
      return exam;
    },
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
          <button disabled={create.isPending} className={buttonClass}>{create.isPending ? 'Saving…' : classIds.length ? `Create for ${classIds.length} class${classIds.length === 1 ? '' : 'es'}` : 'Create exam'}</button>
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
      <Field label="Classes (optional)">
        <ClassMultiSelect classes={(classes.data ?? []).filter((item) => type !== 'PRE_PUBLIC' || /\b(10|x)\b/i.test(item.name) || item.sortOrder === 10)} value={classIds} onChange={setClassIds} />
      </Field>
      {classIds.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Maximum marks">
            <input required type="number" min={1} step="0.5" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Pass marks (optional)">
            <input type="number" min={0} step="0.5" value={passMarks} onChange={(event) => setPassMarks(event.target.value)} className={inputClass} />
          </Field>
        </div>
      )}
      <p className="text-xs text-muted">
        Every subject that is switched on, in every section of the chosen classes, is added to the exam. You can add classes
        later too. Teachers create slip tests themselves.
      </p>
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
  const [classIds, setClassIds] = useState<string[]>([]);
  const classes = useQuery({ queryKey: ['classes', exam.academicYearId], queryFn: () => api.classes(exam.academicYearId) });
  const sections = useQuery({ queryKey: ['sections', classId], queryFn: () => api.sections(classId), enabled: Boolean(classId) && !wholeClass });
  const subjects = useQuery({ queryKey: ['section-subjects', sectionId], queryFn: () => api.sectionSubjects(sectionId), enabled: Boolean(sectionId) && !wholeClass });
  const add = useMutation({
    mutationFn: async () => {
      const marks = { maxMarks: Number(maxMarks), passMarks: passMarks ? Number(passMarks) : undefined };
      if (wholeClass) return api.addClassSubjects(exam.id, { classIds, ...marks });
      return api.addAssessment(exam.id, { classId, subjectId, ...marks });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['exams'] });
      await client.invalidateQueries({ queryKey: ['exam-sections', exam.id] });
      onClose();
    },
  });

  return (
    <Dialog
      title={`Add subjects to ${exam.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={add.isPending || (wholeClass && !classIds.length)} className={buttonClass}>{add.isPending ? 'Saving…' : wholeClass ? `Add all subjects${classIds.length ? ` (${classIds.length} class${classIds.length === 1 ? '' : 'es'})` : ''}` : 'Add subject'}</button>
        </>
      }
    >
      <div role="radiogroup" aria-label="What to add" className="grid gap-2 sm:grid-cols-2">
        {[
          { value: true, label: 'Whole classes', hint: 'Every subject that is on, in every section of the chosen classes' },
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
        {wholeClass ? (
          <Field label="Classes">
            <ClassMultiSelect
              classes={(classes.data ?? []).filter((item) => exam.type !== 'PRE_PUBLIC' || /\b(10|x)\b/i.test(item.name) || item.sortOrder === 10)}
              value={classIds}
              onChange={setClassIds}
            />
          </Field>
        ) : (
          <Field label="Class">
            <select required value={classId} onChange={(event) => { setClassId(event.target.value); setSectionId(''); setSubjectId(''); }} className={inputClass}>
              <option value="">Choose a class</option>
              {classes.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        )}
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

const SECTION_STATUS: Record<ExamStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Waiting for marks', className: 'bg-slate-100 text-slate-700' },
  VERIFIED: { label: 'Admin approved', className: 'bg-amber-100 text-amber-800' },
  LOCKED: { label: 'Admin approved', className: 'bg-amber-100 text-amber-800' },
  RELEASED: { label: 'Released to families', className: 'bg-emerald-100 text-emerald-800' },
};

/** One exam with its sections: each section is approved and released on its own. */
function ExamRow({ exam, onAddSubject }: { exam: Examination; onAddSubject(exam: Examination): void }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const isAdmin = roles.includes('School Admin') || roles.includes('Super Admin');
  const isPrincipal = roles.includes('Principal') || roles.includes('Super Admin');
  const slipTest = exam.type === 'SLIP_TEST';
  const canView = permissions.includes('marks:verify');
  const progress = useQuery({
    queryKey: ['exam-sections', exam.id],
    queryFn: () => api.examSections(exam.id),
    enabled: canView,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['exams'] });
    await client.invalidateQueries({ queryKey: ['exam-sections', exam.id] });
  };
  const sectionAct = useMutation({
    mutationFn: ({ sectionId, action }: { sectionId: string; action: 'verify' | 'release' | 'reject' }) =>
      api.sectionAction(exam.id, sectionId, action),
    onSuccess: async (result) => {
      setNotice(result.examReleased ? `${result.name} released. Every section is now released.` : '');
      await refresh();
    },
  });
  const bulk = useMutation({
    mutationFn: async (action: 'verify' | 'release') => {
      if (action === 'verify') {
        const result = await api.approveReadySections(exam.id);
        return { verb: 'Approved', done: result.approved, waiting: result.waiting };
      }
      const result = await api.releaseApprovedSections(exam.id);
      return { verb: 'Released', done: result.released, waiting: result.waiting };
    },
    onSuccess: async (result) => {
      const { done, verb } = result;
      setNotice(
        done.length
          ? `${verb} ${done.map((row) => row.name).join(', ')}.${result.waiting.length ? ` Still waiting: ${result.waiting.map((row) => row.name).join(', ')}.` : ''}`
          : `Nothing to ${verb === 'Approved' ? 'approve' : 'release'} yet.`,
      );
      await refresh();
    },
  });
  const sections = progress.data?.sections ?? [];
  const readyCount = sections.filter((row) => row.status === 'DRAFT' && row.complete).length;
  const approvedCount = sections.filter((row) => row.status === 'VERIFIED').length;
  const releasedCount = sections.filter((row) => row.status === 'RELEASED').length;
  const summary =
    exam.status === 'RELEASED'
      ? STATUS.RELEASED
      : releasedCount
        ? { label: `${releasedCount} of ${sections.length} released`, className: 'bg-emerald-50 text-emerald-800' }
        : approvedCount
          ? { label: `${approvedCount} of ${sections.length} approved`, className: STATUS.VERIFIED.className }
          : STATUS[exam.status];
  const error = sectionAct.error ?? bulk.error;

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-52 flex-1 items-center gap-2 text-left">
          <ChevronDown className={`size-4 text-muted transition ${open ? '' : '-rotate-90'}`} aria-hidden />
          <span>
            <span className="block font-bold">{exam.name}</span>
            <span className="text-xs text-muted">
              {TYPE_LABELS[exam.type]} · {exam._count?.assessments ?? 0} subject(s){sections.length ? ` · ${sections.length} section(s)` : ''}
            </span>
          </span>
        </button>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${summary.className}`}>{summary.label}</span>
        <div className="flex flex-wrap gap-2">
          {exam.status === 'DRAFT' && permissions.includes('examinations:manage') && !slipTest && (
            <button onClick={() => onAddSubject(exam)} className={ghostButtonClass}>
              <Plus className="size-4" aria-hidden /> Subjects
            </button>
          )}
          {exam.status === 'DRAFT' && isAdmin && readyCount > 0 && (
            <button disabled={bulk.isPending} onClick={() => bulk.mutate('verify')} className={buttonClass}>
              <CheckCircle2 className="size-4" aria-hidden /> {slipTest ? 'Approve and release' : `Approve ${readyCount} ready section${readyCount === 1 ? '' : 's'}`}
            </button>
          )}
          {exam.status === 'DRAFT' && isPrincipal && !slipTest && approvedCount > 0 && (
            <button disabled={bulk.isPending} onClick={() => bulk.mutate('release')} className={buttonClass}>
              <Send className="size-4" aria-hidden /> Release {approvedCount} approved section{approvedCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-medium text-red-600">{errorText(error)}</p>}
      {notice && !error && <p role="status" className="mt-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {open && (
        <div className="mt-3 overflow-x-auto rounded-xl bg-page p-3">
          {progress.isLoading && <p className="text-sm text-muted">Loading sections…</p>}
          {progress.isError && <p className="text-sm text-red-600">{errorText(progress.error)}</p>}
          {progress.data && sections.length === 0 && <p className="text-sm text-muted">No subjects added yet.</p>}
          {sections.length > 0 && (
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Section</th>
                  <th className="pb-2">Subjects</th>
                  <th className="pb-2">Marks submitted</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {sections.map((row) => {
                  const state = SECTION_STATUS[row.status];
                  const busy = sectionAct.isPending && sectionAct.variables?.sectionId === row.section.id;
                  return (
                    <tr key={row.section.id} className="border-t border-line">
                      <td className="py-2 font-semibold">{row.class.name}-{row.section.name}</td>
                      <td className="py-2">{row.subjects}</td>
                      <td className={`py-2 font-semibold ${row.complete ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {row.submitted} / {row.expected}
                        <span className="ml-1 text-xs font-normal text-muted">({row.students} students)</span>
                      </td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${state.className}`}>{state.label}</span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {exam.status === 'DRAFT' && row.status === 'DRAFT' && isAdmin && (
                          <button
                            disabled={!row.complete || busy}
                            title={row.complete ? undefined : `${row.missing} marks missing or not submitted`}
                            onClick={() => sectionAct.mutate({ sectionId: row.section.id, action: 'verify' })}
                            className={`${buttonClass} px-3 py-1.5 text-xs`}
                          >
                            {slipTest ? 'Approve and release' : 'Approve'}
                          </button>
                        )}
                        {exam.status === 'DRAFT' && row.status === 'VERIFIED' && isPrincipal && !slipTest && (
                          <button disabled={busy} onClick={() => sectionAct.mutate({ sectionId: row.section.id, action: 'release' })} className={`${buttonClass} px-3 py-1.5 text-xs`}>
                            Release
                          </button>
                        )}
                        {exam.status === 'DRAFT' && row.status === 'VERIFIED' && (isAdmin || isPrincipal) && (
                          <button disabled={busy} onClick={() => sectionAct.mutate({ sectionId: row.section.id, action: 'reject' })} className={`${ghostButtonClass} ml-1 px-3 py-1.5 text-xs`}>
                            <Undo2 className="size-3.5" aria-hidden /> Send back
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted">
            {slipTest
              ? 'A slip test is released as soon as the School Admin approves it.'
              : 'Each section is approved by the School Admin when its marks are complete, then released by the Principal. Released sections are visible to their students, parents and teachers straight away.'}
          </p>
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
        subtitle="Teachers submit marks. The School Admin approves each section when it is complete and the Principal releases it, so finished sections do not wait for the rest. Slip tests need only the School Admin."
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
