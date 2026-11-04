import { initials } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, GraduationCap, LayoutDashboard, LogOut, ShieldCheck, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

const LINKS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/students', label: 'Students', icon: Users },
  { to: '/approvals', label: 'Approvals', icon: ShieldCheck },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const { data: approvals } = useQuery({ queryKey: ['approvals'], queryFn: api.approvals });

  return (
    <div className="min-h-screen md:flex">
      <aside className="flex items-center gap-2 overflow-x-auto bg-ink px-4 py-3 text-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:flex-col md:items-stretch md:gap-1 md:overflow-visible md:p-5">
        <div className="mr-3 flex shrink-0 items-center gap-3 md:mr-0 md:mb-8">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-amber-400">
            <GraduationCap className="size-6" aria-hidden />
          </span>
          <span className="hidden md:block">
            <span className="block text-sm leading-tight font-bold">{user?.school?.name ?? 'School ERP'}</span>
            <span className="block text-xs text-indigo-200">{user?.roles[0]}</span>
          </span>
        </div>
        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isActive ? 'bg-white text-ink' : 'text-indigo-100 hover:bg-white/10'
              }`
            }
          >
            <Icon className="size-5" aria-hidden />
            {label}
            {to === '/approvals' && Boolean(approvals?.total) && (
              <span className="ml-auto rounded-full bg-amber-400 px-2 text-xs font-bold text-ink">
                {approvals?.total}
              </span>
            )}
          </NavLink>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-3 md:mt-auto md:ml-0 md:border-t md:border-white/10 md:pt-4">
          <span className="hidden size-9 place-items-center rounded-full bg-white/15 text-xs font-bold md:grid">
            {initials(user?.displayName ?? '')}
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-sm font-medium md:block">{user?.displayName}</span>
          <button
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="rounded-lg p-2 text-indigo-100 hover:bg-white/10"
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
