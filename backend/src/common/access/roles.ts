export const ROLE = {
  SUPER_ADMIN: 'Super Admin',
  SCHOOL_ADMIN: 'School Admin',
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  ACCOUNTANT: 'Accountant',
  PARENT: 'Parent',
  STUDENT: 'Student',
  LIBRARIAN: 'Librarian',
  TRANSPORT: 'Transport Staff',
  RECEPTION: 'Reception',
} as const;

export const SYSTEM_ROLES: string[] = Object.values(ROLE);
