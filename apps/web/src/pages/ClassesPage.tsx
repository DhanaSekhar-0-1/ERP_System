import type { ClassCard } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, LayoutGrid, Pencil, Plus, Trash2, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ConfirmDialog, Dialog, DialogButtons, Field, FormError } from '../components/Dialog';
import { buttonClass, errorText, inputClass, Message, PageHeader } from '../components/ui';
import { useActiveYear } from '../hooks';

function ClassDialog({ yearId, existing, nextOrder, onClose }: {
  yearId: string;
  existing?: ClassCard;
  nextOrder: number;
  onClose(): void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(existing?.name ?? `Class ${nextOrder}`);
  const [order, setOrder] = useState(String(existing?.sortOrder ?? nextOrder));
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.updateClass(existing.id, { name: name.trim(), sortOrder: Number(order) })
        : api.createClass({ academicYearId: yearId, name: name.trim(), sortOrder: Number(order) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['class-cards'] });
      await client.invalidateQueries({ queryKey: ['class-detail'] });
      onClose();
    },
  });
  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : 'Create a class'}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      footer={<DialogButtons onClose={onClose} pending={save.isPending} label={existing ? 'Save' : 'Create class'} />}
    >
      <Field label="Class name">
        <input required autoFocus value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
      </Field>
      <Field label="Order (1 for Class 1, 10 for Class 10)">
        <input required type="number" min={0} max={20} value={order} onChange={(event) => setOrder(event.target.value)} className={inputClass} />
      </Field>
      {!existing && (
        <p className="rounded-xl bg-brand-soft p-3 text-xs text-brand">
          The class starts with Section A and the school's default subjects. You can add more sections afterwards.
        </p>
      )}
      <FormError error={save.error} />
    </Dialog>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="size-4 text-muted" aria-hidden />
      <span className="font-bold">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

export function ClassesPage() {
  const { user } = useAuth();
  const canManage = Boolean(user?.permissions.includes('classes:manage'));
  const { year, loading } = useActiveYear();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ClassCard | null>(null);
  const [deleting, setDeleting] = useState<ClassCard | null>(null);
  const cards = useQuery({ queryKey: ['class-cards', year?.id], queryFn: () => api.classCards(year!.id), enabled: Boolean(year) });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteClass(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['class-cards'] });
      setDeleting(null);
    },
  });
  const nextOrder = Math.max(0, ...(cards.data ?? []).map((item) => item.sortOrder)) + 1;

  return (
    <>
      <PageHeader
        title="Class Management"
        subtitle={loading ? 'Loading…' : year ? `Classes, sections and subjects for ${year.name}` : 'No active academic year'}
        action={
          canManage && year && (
            <button onClick={() => setCreating(true)} className={buttonClass}>
              <Plus className="size-4" aria-hidden /> Create class
            </button>
          )
        }
      />
      {cards.isLoading && <Message>Loading classes…</Message>}
      {cards.isError && <Message tone="error">{errorText(cards.error)}</Message>}
      {cards.data?.length === 0 && <Message>No classes yet. Create Class 1 to begin.</Message>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.data?.map((item) => (
          <article key={item.id} className="group relative rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:border-brand hover:shadow-md">
            <Link to={`/classes/${item.id}`} className="block after:absolute after:inset-0 after:content-['']">
              <span className="mb-3 grid size-11 place-items-center rounded-xl bg-brand-soft text-lg font-extrabold text-brand">
                {item.name.replace(/\D/g, '') || item.name.slice(0, 2)}
              </span>
              <h2 className="text-lg font-extrabold">{item.name}</h2>
            </Link>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat icon={LayoutGrid} value={item.sections} label={item.sections === 1 ? 'section' : 'sections'} />
              <Stat icon={BookOpen} value={item.subjects} label="subjects" />
              <Stat icon={UserCheck} value={item.teachers} label={item.teachers === 1 ? 'teacher' : 'teachers'} />
              <Stat icon={Users} value={item.students} label="students" />
            </div>
            {canManage && (
              <div className="absolute top-4 right-4 z-10 flex gap-1">
                <button onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`} className="rounded-lg p-2 text-muted hover:bg-page hover:text-ink">
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button onClick={() => setDeleting(item)} aria-label={`Delete ${item.name}`} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {creating && year && <ClassDialog yearId={year.id} nextOrder={nextOrder} onClose={() => setCreating(false)} />}
      {editing && year && <ClassDialog yearId={year.id} existing={editing} nextOrder={nextOrder} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message={
            <>
              This removes its {deleting.sections} section(s), their subjects and teacher assignments. It cannot be
              undone. Classes with students, exams, homework, fees or timetables cannot be deleted.
            </>
          }
          confirmLabel="Delete class"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => {
            remove.reset();
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
