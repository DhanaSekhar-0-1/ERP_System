import type { Staff, StaffAssignment } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, UserPlus, X } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useActiveYear } from '../hooks';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

export function Dialog({ title, onClose, onSubmit, children, footer }: {
  title: string;
  onClose(): void;
  onSubmit(event: FormEvent): void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-10 grid place-items-center bg-ink/50 p-4">
      <form onSubmit={onSubmit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-page">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="grid gap-4">{children}</div>
        <div className="mt-6 flex justify-end gap-2">{footer}</div>
      </form>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}

function RegisterTeacherDialog({ onClose }: { onClose(): void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', employeeNo: '', nfcId: '', designation: 'Teacher', phone: '' });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const create = useMutation({
    mutationFn: () =>
      api.createTeacher({
        ...form,
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        employeeNo: form.employeeNo.trim(),
        nfcId: form.nfcId.trim(),
        designation: form.designation.trim() || undefined,
        phone: form.phone.trim() || undefined,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });

  return (
    <Dialog
      title="Register a teacher"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={create.isPending} className={buttonClass}>{create.isPending ? 'Saving…' : 'Register teacher'}</button>
        </>
      }
    >
      <Field label="Full name">
        <input required autoFocus value={form.displayName} onChange={set('displayName')} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Login email">
          <input required type="email" value={form.email} onChange={set('email')} className={inputClass} />
        </Field>
        <Field label="Temporary password">
          <input required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} className={inputClass} />
        </Field>
        <Field label="Employee number">
          <input required value={form.employeeNo} onChange={set('employeeNo')} className={inputClass} />
        </Field>
        <Field label="NFC card ID">
          <input required value={form.nfcId} onChange={set('nfcId')} className={`${inputClass} font-mono`} />
        </Field>
        <Field label="Designation">
          <input value={form.designation} onChange={set('designation')} className={inputClass} />
        </Field>
        <Field label="Phone (optional)">
          <input value={form.phone} onChange={set('phone')} className={inputClass} />
        </Field>
      </div>
      {create.isError && <p role="alert" className="text-sm font-medium text-red-600">{errorText(create.error)}</p>}
    </Dialog>
  );
}

function AssignDialog({ staff, yearId, onClose }: { staff: Staff; yearId: string; onClose(): void }) {
  const client = useQueryClient();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  const classes = useQuery({ queryKey: ['classes', yearId], queryFn: () => api.classes(yearId) });
  const subjects = useQuery({ queryKey: ['subjects', yearId], queryFn: () => api.subjects(yearId) });
  const sections = useQuery({ queryKey: ['sections', classId], queryFn: () => api.sections(classId), enabled: Boolean(classId) });
  const assign = useMutation({
    mutationFn: () =>
      api.assignTeacher(staff.id, {
        academicYearId: yearId,
        classId,
        sectionId: sectionId || undefined,
        subjectId,
        isClassTeacher,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['assignments'] });
      onClose();
    },
  });

  return (
    <Dialog
      title={`Assign ${staff.user.displayName}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        assign.mutate();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
          <button disabled={assign.isPending} className={buttonClass}>{assign.isPending ? 'Saving…' : 'Assign'}</button>
        </>
      }
    >
      <Field label="Class">
        <select required value={classId} onChange={(event) => { setClassId(event.target.value); setSectionId(''); }} className={inputClass}>
          <option value="">Choose a class</option>
          {classes.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Section">
        <select required={isClassTeacher} value={sectionId} onChange={(event) => setSectionId(event.target.value)} disabled={!classId} className={inputClass}>
          <option value="">{isClassTeacher ? 'Choose a section' : 'All sections of the class'}</option>
          {sections.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Subject">
        <select required value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className={inputClass}>
          <option value="">Choose a subject</option>
          {subjects.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={isClassTeacher} onChange={(event) => setIsClassTeacher(event.target.checked)} className="size-4" />
        Class teacher of this section
      </label>
      {assign.isError && <p role="alert" className="text-sm font-medium text-red-600">{errorText(assign.error)}</p>}
    </Dialog>
  );
}

function assignmentLabel(assignment: StaffAssignment) {
  const where = assignment.section ? `${assignment.class.name}-${assignment.section.name}` : `${assignment.class.name} (all sections)`;
  return `${assignment.subject.name} · ${where}`;
}

export function TeachersPage() {
  const { user } = useAuth();
  const canRegister = Boolean(user?.permissions.includes('users:manage'));
  const canAssign = Boolean(user?.permissions.includes('staff-assignments:manage'));
  const { year, loading } = useActiveYear();
  const [registering, setRegistering] = useState(false);
  const [assigning, setAssigning] = useState<Staff | null>(null);
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
  const assignments = useQuery({
    queryKey: ['assignments', year?.id],
    queryFn: () => api.staffAssignments(year!.id),
    enabled: Boolean(year),
  });
  const byStaff = new Map<string, StaffAssignment[]>();
  assignments.data?.forEach((item) => byStaff.set(item.staffId, [...(byStaff.get(item.staffId) ?? []), item]));

  return (
    <>
      <PageHeader
        title="Teachers"
        subtitle={loading ? 'Loading…' : year ? `Subjects and classes for ${year.name}` : 'No active academic year'}
        action={
          canRegister && (
            <button onClick={() => setRegistering(true)} className={buttonClass}>
              <UserPlus className="size-4" aria-hidden /> Register teacher
            </button>
          )
        }
      />
      <Card>
        {staff.isLoading && <Message>Loading teachers…</Message>}
        {staff.isError && <Message tone="error">{errorText(staff.error)}</Message>}
        {staff.data?.length === 0 && <Message>No teachers yet.</Message>}
        <ul className="divide-y divide-line">
          {staff.data?.map((member) => {
            const own = byStaff.get(member.id) ?? [];
            const classTeacher = own.find((item) => item.isClassTeacher);
            return (
              <li key={member.id} className="flex flex-wrap items-start gap-4 py-4">
                <div className="min-w-48 flex-1">
                  <p className="font-bold">{member.user.displayName}</p>
                  <p className="text-sm text-muted">
                    {member.employeeNo} · {member.designation ?? 'Staff'} · {member.user.email}
                  </p>
                  {classTeacher?.section && (
                    <span className="mt-1 inline-block rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand">
                      Class teacher of {classTeacher.class.name}-{classTeacher.section.name}
                    </span>
                  )}
                </div>
                <div className="flex min-w-56 flex-1 flex-wrap gap-1.5">
                  {own.length === 0 && <span className="text-sm text-muted">No subjects assigned</span>}
                  {own.map((item) => (
                    <span key={item.id} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold">
                      <BookOpen className="size-3.5 text-muted" aria-hidden />
                      {assignmentLabel(item)}
                    </span>
                  ))}
                </div>
                {canAssign && year && (
                  <button onClick={() => setAssigning(member)} className={ghostButtonClass}>Assign subject</button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {registering && <RegisterTeacherDialog onClose={() => setRegistering(false)} />}
      {assigning && year && <AssignDialog staff={assigning} yearId={year.id} onClose={() => setAssigning(null)} />}
    </>
  );
}
