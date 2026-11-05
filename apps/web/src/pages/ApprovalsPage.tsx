import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { api } from '../api';
import { buttonClass, Card, errorText, ghostButtonClass, Message, PageHeader } from '../components/ui';

const LABELS: Record<string, string> = {
  'attendance.correction': 'Attendance correction',
  'enrollment.transfer': 'Section transfer',
};

export function ApprovalsPage() {
  const client = useQueryClient();
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: api.approvals });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => api.decideApproval(id, decision),
    onSuccess: () => client.invalidateQueries(),
  });

  return (
    <>
      <PageHeader title="Approvals" subtitle="Sensitive changes wait here until you decide." />
      {decide.isError && <Message tone="error">{errorText(decide.error)}</Message>}
      {approvals.isError ? (
        <Message tone="error">{errorText(approvals.error)}</Message>
      ) : approvals.isLoading ? (
        <Message>Loading…</Message>
      ) : !approvals.data?.items.length ? (
        <Card>
          <Message>You're all caught up. Nothing is waiting for approval.</Message>
        </Card>
      ) : (
        <ul className="space-y-3">
          {approvals.data.items.map((request) => (
            <li key={request.id}>
              <Card className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold">{LABELS[request.type] ?? request.type}</p>
                  <p className="mt-0.5 text-sm text-muted">{request.reason}</p>
                  <p className="mt-1 text-xs text-muted">
                    Requested by {request.requester?.displayName ?? 'staff'} · Tier {request.tier}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: request.id, decision: 'reject' })}
                    className={ghostButtonClass}
                  >
                    <X className="size-4" aria-hidden />
                    Reject
                  </button>
                  <button
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: request.id, decision: 'approve' })}
                    className={buttonClass}
                  >
                    <Check className="size-4" aria-hidden />
                    Approve
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
