import { AttendanceStatus, statusStyles } from '@erp/shared';
import { ReactNode } from 'react';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 font-bold">{title}</h2>}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  const style = statusStyles[status];
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold"
      style={{ color: style.color, backgroundColor: style.soft }}
    >
      {style.label}
    </span>
  );
}

export function Message({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={`py-8 text-center text-sm ${tone === 'error' ? 'text-red-600' : 'text-muted'}`}>
      {children}
    </p>
  );
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50';
export const ghostButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-page disabled:opacity-50';
export const inputClass =
  'rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';
