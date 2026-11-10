import { newPasswordProblem } from '@erp/shared';
import { KeyRound } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { buttonClass, errorText, ghostButtonClass, inputClass } from '../components/ui';

/**
 * Shown instead of every other screen while the account is still on the first password the
 * school gave out. The server refuses other requests until the password is changed.
 */
export function NewPasswordPage() {
  const { user, signOut, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = newPasswordProblem(next, confirm, current);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.changePassword(current, next);
      await refresh();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-page p-6">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <span className="mb-4 grid size-12 place-items-center rounded-xl bg-brand-soft text-brand">
          <KeyRound className="size-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight">Choose your own password</h1>
        <p className="mt-2 mb-6 text-sm text-muted">
          Welcome{user?.displayName ? `, ${user.displayName}` : ''}. You signed in with the first password from the school.
          Choose a new one that only you know before you continue.
        </p>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="current">
          First password (from the school)
        </label>
        <input
          id="current"
          type="password"
          required
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          className={`${inputClass} mb-4 w-full`}
        />
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="new">
          New password
        </label>
        <input
          id="new"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          className={`${inputClass} w-full`}
        />
        <p className="mt-1.5 mb-4 text-xs text-muted">At least 8 characters, with a letter and a number.</p>
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="confirm">
          New password again
        </label>
        <input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={`${inputClass} w-full`}
        />
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <button disabled={busy} className={`${buttonClass} mt-6 w-full`}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" onClick={() => void signOut()} className={`${ghostButtonClass} mt-2 w-full`}>
          Sign out
        </button>
      </form>
    </div>
  );
}
