import { useQuery } from '@tanstack/react-query';
import { fullName } from '@erp/shared';
import { api } from './api';
import { useAuth } from './auth';

/** The student these screens are about: yourself, or a parent's first linked child. */
export function useFamilyStudent(): { studentId: string | null; label: string | null; isParent: boolean } {
  const { user } = useAuth();
  const isParent = !user?.studentId && Boolean(user?.guardianId);
  const children = useQuery({
    queryKey: ['children'],
    queryFn: api.myChildren,
    enabled: isParent,
  });
  if (user?.studentId) return { studentId: user.studentId, label: null, isParent };
  const child = children.data?.[0];
  return { studentId: child?.id ?? null, label: child ? fullName(child) : null, isParent };
}
