import { CalendarCheck, GraduationCap, Nfc, ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { buttonClass, errorText, inputClass } from '../components/ui';

const FEATURES = [
  { icon: Nfc, text: 'Tap-to-mark NFC attendance' },
  { icon: CalendarCheck, text: 'Live attendance across every class' },
  { icon: ShieldCheck, text: 'Every change approved and audited' },
];

export function LoginPage() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(identifier.trim(), password);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-ink via-brand-dark to-brand p-12 text-white lg:flex">
        <span className="grid size-14 place-items-center rounded-2xl bg-white/15">
          <GraduationCap className="size-8" aria-hidden />
        </span>
        <div>
          <h1 className="max-w-md text-5xl leading-tight font-extrabold tracking-tight">
            Every student, accounted for.
          </h1>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 font-medium text-indigo-100">
                <span className="grid size-9 place-items-center rounded-lg bg-white/10">
                  <Icon className="size-5 text-amber-300" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-indigo-200">School ERP</p>
      </div>
      <div className="grid place-items-center p-6">
        <form onSubmit={(event) => void submit(event)} className="w-full max-w-sm">
          <h2 className="text-3xl font-extrabold tracking-tight">Welcome back</h2>
          <p className="mt-2 mb-8 text-sm text-muted">Sign in with your school account.</p>
          <label className="mb-1.5 block text-sm font-semibold" htmlFor="identifier">
            Email, student ID or staff ID
          </label>
          <input
            id="identifier"
            required
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            className={`${inputClass} mb-4 w-full`}
          />
          <label className="mb-1.5 block text-sm font-semibold" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${inputClass} w-full`}
          />
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <button disabled={busy} className={`${buttonClass} mt-6 w-full`}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
