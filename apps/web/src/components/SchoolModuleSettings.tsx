import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SchoolModuleKey, SchoolModulesView } from '@erp/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { FormError } from './Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, Message } from './ui';

type Registration = SchoolModulesView['registration'];

/**
 * Which parts of the app this school uses (docs/mvp-plan.md, "Pilot setup"). A switched-off
 * module disappears from the web and phone apps and its API refuses requests. Only the School
 * Admin and Super Admin can change it.
 */
export function SchoolModuleSettings() {
  const { user, refresh } = useAuth();
  const canEdit = Boolean(user?.permissions.includes('schools:manage'));
  const client = useQueryClient();
  const saved = useQuery({ queryKey: ['school-modules'], queryFn: api.schoolModules });
  const [states, setStates] = useState<Partial<Record<SchoolModuleKey, boolean>>>({});
  const [registration, setRegistration] = useState<Registration>({ requireAadhaar: true, requireNfcCard: true });
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!saved.data) return;
    setStates(saved.data.states);
    setRegistration(saved.data.registration);
  }, [saved.data]);
  const save = useMutation({
    mutationFn: () => api.saveSchoolModules({ modules: states, registration }),
    onSuccess: async (data) => {
      client.setQueryData(['school-modules'], data);
      // The menus come from the signed-in context, so read it again.
      await refresh();
      setDone(true);
    },
  });
  const toggle = (key: SchoolModuleKey, on: boolean) => {
    setDone(false);
    setStates((current) => ({ ...current, [key]: on }));
  };
  const useMvp1 = () => {
    if (!saved.data) return;
    setDone(false);
    setStates(Object.fromEntries(saved.data.modules.map((item) => [item.key, item.inMvp1])));
  };

  return (
    <Card title="Modules in use">
      <p className="mb-4 text-sm text-muted">
        Switch off what the school does not use yet. Switched-off parts are hidden in the web and phone apps. Nothing is
        deleted; switching a module back on brings its data back.
      </p>
      {saved.isLoading && <Message>Loading…</Message>}
      {saved.isError && <Message tone="error">{errorText(saved.error)}</Message>}
      {saved.data && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {saved.data.modules.map((item) => (
              <label key={item.key} className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={states[item.key] !== false}
                  disabled={!canEdit}
                  onChange={(event) => toggle(item.key, event.target.checked)}
                />
                <span>
                  <span className="block font-semibold">{item.label}</span>
                  <span className="block text-muted">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
          <h3 className="mt-6 mb-2 text-sm font-bold">Student registration</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={registration.requireAadhaar}
                disabled={!canEdit}
                onChange={(event) => {
                  setDone(false);
                  setRegistration((current) => ({ ...current, requireAadhaar: event.target.checked }));
                }}
              />
              <span>
                <span className="block font-semibold">Aadhaar number required</span>
                <span className="block text-muted">When off, a student can be registered without it and added later.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={registration.requireNfcCard}
                disabled={!canEdit}
                onChange={(event) => {
                  setDone(false);
                  setRegistration((current) => ({ ...current, requireNfcCard: event.target.checked }));
                }}
              />
              <span>
                <span className="block font-semibold">NFC card required</span>
                <span className="block text-muted">When off, cards can be linked later from the student’s page.</span>
              </span>
            </label>
          </div>
          {canEdit && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={useMvp1} className={ghostButtonClass}>
                Use the MVP1 set
              </button>
              <button onClick={() => save.mutate()} disabled={save.isPending} className={buttonClass}>
                {save.isPending ? 'Saving…' : 'Save modules'}
              </button>
              {done && <span role="status" className="text-sm font-semibold text-emerald-700">Saved</span>}
            </div>
          )}
          <div className="mt-2">
            <FormError error={save.error} />
          </div>
        </>
      )}
    </Card>
  );
}
