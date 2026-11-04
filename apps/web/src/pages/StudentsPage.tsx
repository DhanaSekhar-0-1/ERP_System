import { fullName, Student } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Nfc, Search, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

/** A USB reader in keyboard mode types the card ID and presses Enter, which submits this form. */
function AssignCardDialog({ student, onClose }: { student: Student; onClose(): void }) {
  const client = useQueryClient();
  const [cardId, setCardId] = useState(student.nfcId ?? '');
  const assign = useMutation({
    mutationFn: () => api.assignCard(student.id, cardId.trim()),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    assign.mutate();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="assign-title" className="fixed inset-0 z-10 grid place-items-center bg-ink/50 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 id="assign-title" className="text-lg font-extrabold">
            Assign card to {fullName(student)}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-page">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1 mb-4 text-sm text-muted">Tap the card on a USB reader, or type its ID.</p>
        <label htmlFor="card-id" className="mb-1.5 block text-sm font-semibold">
          Card ID
        </label>
        <input
          id="card-id"
          autoFocus
          required
          value={cardId}
          onChange={(event) => setCardId(event.target.value)}
          className={`${inputClass} w-full font-mono`}
        />
        {assign.isError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {errorText(assign.error)}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={ghostButtonClass}>
            Cancel
          </button>
          <button disabled={assign.isPending} className={buttonClass}>
            {assign.isPending ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function StudentsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Student | null>(null);
  const canAssign = user?.permissions.includes('students:manage');
  const students = useQuery({
    queryKey: ['students', search, page],
    queryFn: () => api.students(search.trim(), page),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader title="Students" subtitle={`${students.data?.total ?? 0} enrolled`} />
      <Card>
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute top-3 left-3 size-4 text-muted" aria-hidden />
          <input
            aria-label="Search students"
            placeholder="Search by name or admission no."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        {students.isError ? (
          <Message tone="error">{errorText(students.error)}</Message>
        ) : students.isLoading ? (
          <Message>Loading…</Message>
        ) : !students.data?.items.length ? (
          <Message>No students found.</Message>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="pb-2 font-semibold">Student</th>
                  <th className="pb-2 font-semibold">Admission no.</th>
                  <th className="pb-2 font-semibold">NFC card</th>
                  {canAssign && <th className="pb-2" />}
                </tr>
              </thead>
              <tbody>
                {students.data.items.map((student) => (
                  <tr key={student.id} className="border-t border-line">
                    <td className="py-2.5 font-semibold">{fullName(student)}</td>
                    <td className="py-2.5 text-muted">{student.admissionNo}</td>
                    <td className="py-2.5 font-mono text-xs text-muted">{student.nfcId ?? 'No card'}</td>
                    {canAssign && (
                      <td className="py-2.5 text-right">
                        <button onClick={() => setEditing(student)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold text-brand hover:bg-brand-soft">
                          <Nfc className="size-4" aria-hidden />
                          Assign card
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(students.data?.totalPages ?? 0) > 1 && (
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className={ghostButtonClass}>
              Previous
            </button>
            <span className="px-2 text-muted">
              Page {page} of {students.data?.totalPages}
            </span>
            <button disabled={page === students.data?.totalPages} onClick={() => setPage(page + 1)} className={ghostButtonClass}>
              Next
            </button>
          </div>
        )}
      </Card>
      {editing && <AssignCardDialog student={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
