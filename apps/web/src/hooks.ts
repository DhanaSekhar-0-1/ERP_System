import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** The school's active academic year, which the setup and exam pages work in. */
export function useActiveYear() {
  const years = useQuery({ queryKey: ['academic-years'], queryFn: api.academicYears });
  return {
    year: years.data?.find((year) => year.isActive) ?? null,
    loading: years.isLoading,
  };
}
