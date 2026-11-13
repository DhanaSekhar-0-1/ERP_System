import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { FormError } from '../components/Dialog';
import { SchoolModuleSettings } from '../components/SchoolModuleSettings';
import { TeacherCheckInSettings } from '../components/TeacherCheckInSettings';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

interface Row {
  name: string;
  code: string;
  isOptional: boolean;
}

/** The school's default subject list, copied into every new section. */
export function SettingsPage() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.permissions.includes('subjects:manage'));
  const client = useQueryClient();
  const saved = useQuery({ queryKey: ['default-subjects'], queryFn: api.defaultSubjects });
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (saved.data) setRows(saved.data.map((item) => ({ ...item })));
  }, [saved.data]);
  const save = useMutation({
    mutationFn: () =>
      api.saveDefaultSubjects(rows.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), code: row.code.trim() || undefined, isOptional: row.isOptional }))),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['default-subjects'] });
      setDone(true);
    },
  });
  const update = (index: number, change: Partial<Row>) => {
    setDone(false);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="School-wide defaults" />
      <Card title="Default subjects">
        <p className="mb-4 text-sm text-muted">
          Every new section gets its own copy of this list. Optional subjects, such as Sanskrit, start switched off. Changing
          the list does not change sections that already exist.
        </p>
        {saved.isLoading && <Message>Loading…</Message>}
        {saved.isError && <Message tone="error">{errorText(saved.error)}</Message>}
        <div className="grid gap-2">
          {rows.map((row, index) => (
            <div key={index} className="grid items-center gap-2 sm:grid-cols-[1fr_8rem_auto_auto]">
              <input aria-label={`Subject ${index + 1} name`} value={row.name} disabled={!canEdit} onChange={(event) => update(index, { name: event.target.value })} className={inputClass} />
              <input aria-label={`Subject ${index + 1} code`} value={row.code} disabled={!canEdit} placeholder="Code" onChange={(event) => update(index, { code: event.target.value.toUpperCase() })} className={`${inputClass} font-mono`} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={row.isOptional} disabled={!canEdit} onChange={(event) => update(index, { isOptional: event.target.checked })} className="size-4" />
                Optional
              </label>
              {canEdit && (
                <button onClick={() => setRows((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${row.name || 'subject'}`} className="justify-self-start rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => setRows((current) => [...current, { name: '', code: '', isOptional: false }])} className={ghostButtonClass}>
              <Plus className="size-4" aria-hidden /> Add subject
            </button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className={buttonClass}>
              {save.isPending ? 'Saving…' : 'Save default subjects'}
            </button>
            {done && <span role="status" className="text-sm font-semibold text-emerald-700">Saved</span>}
          </div>
        )}
        <div className="mt-2"><FormError error={save.error} /></div>
      </Card>
      <div className="mt-6">
        <TeacherCheckInSettings />
      </div>
      <div className="mt-6">
        <SchoolModuleSettings />
      </div>
    </>
  );
}
