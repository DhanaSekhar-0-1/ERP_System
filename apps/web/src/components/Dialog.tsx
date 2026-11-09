import { X } from 'lucide-react';
import { FormEvent, ReactNode } from 'react';
import { buttonClass, errorText, ghostButtonClass } from './ui';

export function Dialog({ title, onClose, onSubmit, children, footer }: {
  title: string;
  onClose(): void;
  onSubmit(event: FormEvent): void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-20 grid place-items-center bg-ink/50 p-4">
      <form onSubmit={onSubmit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-page">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="grid gap-4">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>
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

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="text-sm font-medium text-red-600">{errorText(error)}</p>;
}

/** Standard Cancel + submit buttons for a dialog. */
export function DialogButtons({ onClose, pending, label, danger }: { onClose(): void; pending: boolean; label: string; danger?: boolean }) {
  return (
    <>
      <button type="button" onClick={onClose} className={ghostButtonClass}>Cancel</button>
      <button
        disabled={pending}
        className={danger ? `${buttonClass} bg-red-600 hover:bg-red-700` : buttonClass}
      >
        {pending ? 'Saving…' : label}
      </button>
    </>
  );
}

/** Asks before a destructive action and shows why the server refused it. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose, pending, error }: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
  pending: boolean;
  error: unknown;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
      footer={<DialogButtons onClose={onClose} pending={pending} label={confirmLabel} danger />}
    >
      <div className="text-sm text-muted">{message}</div>
      <FormError error={error} />
    </Dialog>
  );
}
