import type { StaffAssignment } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useActiveYear } from '../hooks';
import { Dialog, Field } from '../components/Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

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
