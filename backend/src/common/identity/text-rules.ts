/**
 * Shape rules shared by student and teacher registration. Names are kept in English letters
 * because school records use them (and a student's family name makes the first password).
 */

/** Letters, spaces, full stops, apostrophes and hyphens, starting with a letter. */
export const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;

/** The problem with a name, or null when it is fine. */
export function nameProblem(
  label: string,
  value: string | undefined | null,
  options: { required: boolean; max?: number },
): string | null {
  const text = value?.trim() ?? '';
  const max = options.max ?? 80;
  if (!text) return options.required ? `${label} is required` : null;
  if (text.length > max) return `${label} is longer than ${max} characters`;
  if (/[^\x00-\x7F]/.test(text)) return `${label} must be written in English letters`;
  if (!NAME_PATTERN.test(text)) {
    return `${label} can only contain letters, spaces, full stops, apostrophes and hyphens`;
  }
  return null;
}

/**
 * A real calendar date from YYYY-MM-DD (time ignored). Returns null for text that is not a
 * date or for a day that does not exist, so 2015-02-31 is refused instead of becoming 3 March.
 */
export function realDate(value: string | undefined | null): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

/** Whole years between a birth date and today. */
export function ageInYears(birth: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const birthday = Date.UTC(today.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate());
  if (today.getTime() < birthday) age -= 1;
  return age;
}
