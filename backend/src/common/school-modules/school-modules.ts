import { SetMetadata } from '@nestjs/common';

/**
 * Parts of the app a school can switch off (docs/mvp-plan.md, "Pilot setup"). A switched-off
 * module's screens are hidden and its API refuses requests. A school that never sets a switch
 * has every module on, so existing schools and the test suite are unaffected.
 */
export const SCHOOL_MODULES = [
  { key: 'exams', label: 'Exams and marks', description: 'Exams, marks entry, slip tests, results and report cards', mvp1: false },
  { key: 'announcements', label: 'Notices', description: 'Announcements and notices', mvp1: false },
  { key: 'homework', label: 'Homework', description: 'Homework and submissions', mvp1: false },
  { key: 'fees', label: 'Fees', description: 'Fee structures, payments, receipts and discounts', mvp1: false },
  { key: 'timetable', label: 'Timetable', description: 'Timetables and substitute teachers', mvp1: false },
  { key: 'transport', label: 'Transport', description: 'Routes, buses and boarding', mvp1: false },
  { key: 'library', label: 'Library', description: 'Books and issues', mvp1: false },
  { key: 'assets', label: 'Assets', description: 'School assets', mvp1: false },
  { key: 'complaints', label: 'Complaints and feedback', description: 'Complaints and feedback from families', mvp1: false },
  { key: 'certificates', label: 'Certificates', description: 'Bonafide, study and transfer certificates', mvp1: false },
  { key: 'parentLogin', label: 'Parent login', description: 'Separate parent accounts; when off, families use the student login', mvp1: false },
] as const;

export type SchoolModuleKey = (typeof SCHOOL_MODULES)[number]['key'];

export const SCHOOL_MODULE_KEY = 'schoolModule';

/** Marks a controller or route as part of a module the school can switch off. */
export const SchoolModule = (key: SchoolModuleKey): MethodDecorator & ClassDecorator =>
  SetMetadata(SCHOOL_MODULE_KEY, key);

/** Every module's on/off state from school settings metadata; anything unset is on. */
export function moduleStates(metadata: unknown): Record<SchoolModuleKey, boolean> {
  const saved = (metadata as { modules?: Record<string, unknown> } | null)?.modules ?? {};
  return Object.fromEntries(SCHOOL_MODULES.map(({ key }) => [key, saved[key] !== false])) as Record<
    SchoolModuleKey,
    boolean
  >;
}

/** The MVP1 pilot set: every module above off. */
export function mvp1States(): Record<SchoolModuleKey, boolean> {
  return Object.fromEntries(SCHOOL_MODULES.map(({ key, mvp1 }) => [key, mvp1])) as Record<SchoolModuleKey, boolean>;
}
