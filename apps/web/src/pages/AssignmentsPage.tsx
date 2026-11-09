import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, errorText, inputClass, Message, PageHeader } from '../components/ui';
import { useActiveYear } from '../hooks';
import { SectionAssignmentEditor } from './ClassDetailPage';

/** Subject teachers and class teachers for every section, with a class filter. */
export function AssignmentsPage() {
  const { user } = useAuth();
  const canAssign = Boolean(user?.permissions.includes('staff-assignments:manage'));
  const { year, loading } = useActiveYear();
  const [classId, setClassId] = useState('');
  const rows = useQuery({
    queryKey: ['teacher-assignments', year?.id],
    queryFn: () => api.teacherAssignments(year!.id),
    enabled: Boolean(year),
  });
  const classes = [...new Map((rows.data ?? []).map((row) => [row.class.id, row.class])).values()];
  const visible = (rows.data ?? []).filter((row) => !classId || row.class.id === classId);
  const unassigned = visible.reduce((sum, row) => sum + row.subjects.filter((subject) => !subject.teacher).length, 0);

  return (
    <>
      <PageHeader
        title="Teacher Assignments"
        subtitle={
          loading
            ? 'Loading…'
            : year
              ? `Choose a teacher for each subject and a class teacher for each section.${rows.data ? (unassigned ? ` ${unassigned} subject(s) still need a teacher.` : ' Every subject has a teacher.') : ''}`
              : 'No active academic year'
        }
        action={
          <select aria-label="Filter by class" value={classId} onChange={(event) => setClassId(event.target.value)} className={inputClass}>
            <option value="">All classes</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        }
      />
      {rows.isLoading && <Message>Loading assignments…</Message>}
      {rows.isError && <Message tone="error">{errorText(rows.error)}</Message>}
      {rows.data?.length === 0 && <Message>No sections yet. Create classes first.</Message>}
      <div className="grid gap-4 xl:grid-cols-2">
        {visible.map((row) => (
          <Card key={row.sectionId} title={`${row.class.name} – Section ${row.sectionName}`}>
            <SectionAssignmentEditor
              sectionId={row.sectionId}
              sectionLabel={`${row.class.name}-${row.sectionName}`}
              canAssign={canAssign}
              classTeacherId={row.classTeacher?.staffId ?? ''}
              subjects={row.subjects.map((subject) => ({
                subjectId: subject.subjectId,
                name: subject.name,
                isOptional: subject.isOptional,
                teacherId: subject.teacher?.staffId ?? '',
              }))}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
