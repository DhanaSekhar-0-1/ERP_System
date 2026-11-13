/**
 * School-local dates and times. A school day and "late after 9:15" are decided in the school's
 * time zone (school settings), not the server's.
 */

/** Today's date (YYYY-MM-DD) and time (HH:MM) at the school, for the given instant. */
export function schoolNow(timeZone: string, at = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The instant for a school-local date and HH:MM time, for example 2026-11-10 08:55 in Asia/Kolkata. */
export function schoolTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // How far the zone is from UTC at that moment, read back through Intl.
  const local = schoolNow(timeZone, new Date(guess));
  const [lh, lm] = local.time.split(':').map(Number);
  const [ly, lmo, ld] = local.date.split('-').map(Number);
  const offset = Date.UTC(ly, lmo - 1, ld, lh, lm) - guess;
  return new Date(guess - offset);
}

/** Whether a time zone name is one the runtime knows, such as Asia/Kolkata. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Metres between two points on Earth (haversine). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}
