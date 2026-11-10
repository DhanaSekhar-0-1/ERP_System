import type { Gender, RegisteredTeacher, StaffAssignment } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Copy, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useActiveYear } from '../hooks';
import { Dialog, Field } from '../components/Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);

/** Shown once after registering: the login and first password to hand to the teacher. */
function RegisteredPanel({ teacher, onClose }: { teacher: RegisteredTeacher; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  const text = `Login ID: ${teacher.loginId}\nFirst password: ${teacher.firstPassword}`;
  return (
    <Dialog
      title="Teacher registered"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        onClose();
      }}
      footer={<button className={buttonClass}>Done</button>}
    >
      <p className="text-sm">
        <span className="font-bold">{teacher.user.displayName}</span> can now sign in. Give them these details. The
        password is shown only now, and they must change it the first time they sign in.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-line bg-page p-4">
        <dt className="text-sm text-muted">Teacher ID (login)</dt>
        <dd className="font-mono text-lg font-extrabold">{teacher.loginId}</dd>
        <dt className="text-sm text-muted">First password</dt>
        <dd className="font-mono text-lg font-extrabold">{teacher.firstPassword}</dd>
        <dt className="text-sm text-muted">Subjects</dt>
        <dd className="text-sm">{teacher.teachingSubjects.join(', ')}</dd>
      </dl>
      <button
        type="button"
        className={ghostButtonClass}
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        <Copy className="size-4" aria-hidden /> {copied ? 'Copied' : 'Copy login details'}
      </button>
    </Dialog>
  );
}

function RegisterTeacherDialog({ onClose }: { onClose(): void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    displayName: '',
    phone: '',
    joiningDate: today(),
    gender: '' as Gender | '',
    dateOfBirth: '',
    email: '',
    address: '',
    nfcId: '',
  });
  const [subjects, setSubjects] = useState<string[]>([]);
  const [registered, setRegistered] = useState<RegisteredTeacher | null>(null);
  const options = useQuery({ queryKey: ['teaching-subjects'], queryFn: api.teachingSubjects });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggle = (name: string) =>
    setSubjects((current) => (current.includes(name) ? current.filter((s) => s !== name) : [...current, name]));
  const create = useMutation({
    mutationFn: () =>
      api.createTeacher({
        displayName: form.displayName.trim(),
        phone: form.phone.trim(),
        joiningDate: form.joiningDate,
        teachingSubjects: subjects,
        gender: form.gender || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        nfcId: form.nfcId.trim() || undefined,
      }),
    onSuccess: async (teacher) => {
      await client.invalidateQueries({ queryKey: ['staff'] });
      setRegistered(teacher);
    },
  });

  if (registered) return <RegisteredPanel teacher={registered} onClose={onClose} />;

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
          <button disabled={create.isPending || subjects.length === 0} className={buttonClass}>
            {create.isPending ? 'Saving…' : 'Register teacher'}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        The app makes the Teacher ID, which is also the login, and a first password the teacher changes at first sign-in.
      </p>
      <Field label="Full name (in English letters)">
        <input required autoFocus maxLength={80} value={form.displayName} onChange={set('displayName')} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile">
          <input required inputMode="tel" placeholder="10 digits" value={form.phone} onChange={set('phone')} className={inputClass} />
        </Field>
        <Field label="Joining date">
          <input required type="date" value={form.joiningDate} onChange={set('joiningDate')} className={inputClass} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Subjects they teach</legend>
        <p className="text-xs text-muted">Pick one or more. The first one picked is the main subject.</p>
        {options.isLoading && <p className="text-sm text-muted">Loading subjects…</p>}
        {options.isError && <p className="text-sm text-red-600">{errorText(options.error)}</p>}
        <div className="flex flex-wrap gap-2">
          {options.data?.map((name) => {
            const index = subjects.indexOf(name);
            const on = index >= 0;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(name)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:bg-page'}`}
              >
                {name}
                {index === 0 && <span className="ml-1.5 text-[10px] uppercase tracking-wide">Main</span>}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Gender (optional)">
          <select value={form.gender} onChange={set('gender')} className={inputClass}>
            <option value="">Not given</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Date of birth (optional)">
          <input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} className={inputClass} />
        </Field>
        <Field label="Email (optional)">
          <input type="email" value={form.email} onChange={set('email')} className={inputClass} />
        </Field>
        <Field label="NFC card ID (optional)">
          <input value={form.nfcId} onChange={set('nfcId')} className={`${inputClass} font-mono`} />
        </Field>
      </div>
      <Field label="Address (optional)">
        <textarea maxLength={300} value={form.address} onChange={set('address')} className={inputClass} rows={2} />
      </Field>
      {create.isError && <p role="alert" className="text-sm font-medium text-red-600">{errorText(create.error)}</p>}
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
                    {member.employeeNo} · {member.teachingSubjects?.length ? member.teachingSubjects.join(', ') : member.designation ?? 'Staff'}
                    {member.user.phone ? ` · ${member.user.phone}` : ''}
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
                  <Link to="/assignments" className={ghostButtonClass}>Assign subjects</Link>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {registering && <RegisterTeacherDialog onClose={() => setRegistering(false)} />}
    </>
  );
}
