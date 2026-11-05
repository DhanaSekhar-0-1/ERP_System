import { Smartphone } from 'lucide-react';
import { useAuth } from '../auth';
import { ghostButtonClass } from '../components/ui';

/** Teachers, students and parents use the mobile app; this portal is for school leaders. */
export function MobileOnlyPage() {
  const { user, signOut } = useAuth();
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Smartphone className="size-8" aria-hidden />
        </span>
        <h1 className="text-2xl font-extrabold">Hi {user?.displayName}, please use the mobile app</h1>
        <p className="mt-2 mb-6 text-sm text-muted">
          This web portal is for principals and school admins. Your attendance and classes are in the mobile app.
        </p>
        <button onClick={() => void signOut()} className={ghostButtonClass}>
          Sign out
        </button>
      </div>
    </div>
  );
}
