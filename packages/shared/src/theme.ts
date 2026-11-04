import type { AttendanceStatus } from './types';

/** Brand colours used by both apps, so web and mobile read as one product. */
export const colors = {
  primary: '#4F46E5',
  primaryDark: '#3730A3',
  primarySoft: '#EEF2FF',
  accent: '#F59E0B',
  ink: '#1E1B4B',
  muted: '#64748B',
  line: '#E2E8F0',
  surface: '#FFFFFF',
  background: '#F6F7FB',
  success: '#059669',
  successSoft: '#D1FAE5',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  info: '#2563EB',
  infoSoft: '#DBEAFE',
};

export const statusStyles: Record<
  AttendanceStatus,
  { label: string; short: string; color: string; soft: string }
> = {
  PRESENT: { label: 'Present', short: 'P', color: colors.success, soft: colors.successSoft },
  ABSENT: { label: 'Absent', short: 'A', color: colors.danger, soft: colors.dangerSoft },
  LATE: { label: 'Late', short: 'L', color: colors.warning, soft: colors.warningSoft },
  ON_LEAVE: { label: 'On leave', short: 'OL', color: colors.info, soft: colors.infoSoft },
  EXCUSED: { label: 'Excused', short: 'E', color: colors.muted, soft: colors.line },
};

export function fullName(person: { firstName: string; lastName?: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
