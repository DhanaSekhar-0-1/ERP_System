import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { FormError } from './Dialog';
import { buttonClass, Card, errorText, ghostButtonClass, inputClass, Message } from './ui';

/**
 * Where the school is, how close a teacher must be to check in, and when a check-in counts as
 * late. Only the School Admin and Super Admin can change it.
 */
export function TeacherCheckInSettings() {
  const { user } = useAuth();
  const canEdit = Boolean(user?.permissions.includes('staff-attendance:manage'));
  const client = useQueryClient();
  const saved = useQuery({ queryKey: ['staff-attendance-settings'], queryFn: api.staffAttendanceSettings });
  const [form, setForm] = useState({ latitude: '', longitude: '', radiusMeters: '200', lateAfter: '09:15' });
  const [locating, setLocating] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!saved.data) return;
    setForm({
      latitude: saved.data.latitude?.toString() ?? '',
      longitude: saved.data.longitude?.toString() ?? '',
      radiusMeters: String(saved.data.radiusMeters),
      lateAfter: saved.data.lateAfter,
    });
  }, [saved.data]);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setDone(false);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
  const save = useMutation({
    mutationFn: () =>
      api.saveStaffAttendanceSettings({
        ...(form.latitude && form.longitude ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : {}),
        radiusMeters: Number(form.radiusMeters),
        lateAfter: form.lateAfter,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['staff-attendance-settings'] });
      setDone(true);
    },
  });
  const useThisDevice = () => {
    if (!navigator.geolocation) {
      setLocating('This browser cannot read its location. Type the latitude and longitude instead.');
      return;
    }
    setLocating('Reading this device’s location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDone(false);
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setLocating(`Location read, accurate to about ${Math.round(position.coords.accuracy)} m. Save to use it.`);
      },
      () => setLocating('Could not read the location. Allow location for this site, or type it in.'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return (
    <Card title="Teacher check-in">
      <p className="mb-4 text-sm text-muted">
        Teachers check in and out on the phone app only when they are within this distance of the school. A check-in after
        the late time counts as late. Use this device’s location while standing at the school, or type it in.
      </p>
      {saved.isLoading && <Message>Loading…</Message>}
      {saved.isError && <Message tone="error">{errorText(saved.error)}</Message>}
      {saved.data && !saved.data.locationReady && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800">
          The school location is not set, so teachers cannot check in yet.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold">
          Latitude
          <input inputMode="decimal" value={form.latitude} disabled={!canEdit} onChange={set('latitude')} placeholder="16.238500" className={`${inputClass} font-mono`} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Longitude
          <input inputMode="decimal" value={form.longitude} disabled={!canEdit} onChange={set('longitude')} placeholder="80.647200" className={`${inputClass} font-mono`} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Check-in distance (metres)
          <input type="number" min={50} max={2000} value={form.radiusMeters} disabled={!canEdit} onChange={set('radiusMeters')} className={inputClass} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Late after
          <input type="time" value={form.lateAfter} disabled={!canEdit} onChange={set('lateAfter')} className={inputClass} />
        </label>
      </div>
      {saved.data && <p className="mt-2 text-xs text-muted">Times are in the school’s time zone ({saved.data.timeZone}).</p>}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={useThisDevice} className={ghostButtonClass}>
            <LocateFixed className="size-4" aria-hidden /> Use this device’s location
          </button>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className={buttonClass}>
            {save.isPending ? 'Saving…' : 'Save check-in settings'}
          </button>
          {done && <span role="status" className="text-sm font-semibold text-emerald-700">Saved</span>}
        </div>
      )}
      {locating && <p className="mt-2 text-sm text-muted" role="status">{locating}</p>}
      <div className="mt-2"><FormError error={save.error} /></div>
    </Card>
  );
}
