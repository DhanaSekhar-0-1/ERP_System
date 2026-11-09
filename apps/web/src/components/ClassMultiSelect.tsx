import type { SchoolClass } from '@erp/shared';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { inputClass } from './ui';

/** A drop-down list of classes with search, Select all, and a tick box per class. */
export function ClassMultiSelect({ classes, value, onChange, label = 'Classes' }: {
  classes: SchoolClass[];
  value: string[];
  onChange(ids: string[]): void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const term = search.trim().toLowerCase();
  const shown = classes.filter((item) => !term || item.name.toLowerCase().includes(term));
  const selected = new Set(value);
  const allShownSelected = shown.length > 0 && shown.every((item) => selected.has(item.id));
  const summary =
    value.length === 0
      ? 'Choose classes'
      : value.length === classes.length
        ? `All classes (${classes.length})`
        : classes.filter((item) => selected.has(item.id)).map((item) => item.name).join(', ');

  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  const toggleShown = () =>
    onChange(
      allShownSelected
        ? value.filter((id) => !shown.some((item) => item.id === id))
        : [...new Set([...value, ...shown.map((item) => item.id)])],
    );

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen(!open)}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${value.length ? '' : 'text-muted'}`}>{summary}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-60 rounded-xl border border-line bg-white p-2 shadow-lg">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              autoFocus
              aria-label="Search classes"
              placeholder="Search classes"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${inputClass} w-full py-2 pl-9`}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold hover:bg-page">
            <input type="checkbox" checked={allShownSelected} onChange={toggleShown} disabled={!shown.length} className="size-4" />
            {term ? `Select all matching (${shown.length})` : `Select all (${classes.length})`}
          </label>
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-56 overflow-y-auto border-t border-line pt-1">
            {shown.map((item) => (
              <li key={item.id} role="option" aria-selected={selected.has(item.id)}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-page">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="size-4" />
                  <span className="flex-1">{item.name}</span>
                  {selected.has(item.id) && <Check className="size-4 text-brand" aria-hidden />}
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-3 text-sm text-muted">No class matches “{search}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
