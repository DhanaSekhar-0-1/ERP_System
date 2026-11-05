import { daysAgo, fullName, isoDate, shortDate } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { buttonClass, Card, errorText, inputClass, Message, PageHeader, StatusBadge } from '../components/ui';

function saveCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function AttendancePage() {
  const [date, setDate] = useState(isoDate());
  const [selected, setSelected] = useState('');
  const [exportError, setExportError] = useState('');
  const sections = useQuery({ queryKey: ['sections', date], queryFn: () => api.mySections(date) });
  const sectionId = selected || sections.data?.[0]?.id || '';
  const roster = useQuery({
    queryKey: ['roster', sectionId, date],
    queryFn: () => api.sectionAttendance(sectionId, date),
    enabled: Boolean(sectionId),
  });

  const exportCsv = async () => {
    setExportError('');
    const from = daysAgo(30);
    const to = isoDate();
    try {
      saveCsv(await api.attendanceCsv(from, to), `attendance-${from}-to-${to}.csv`);
    } catch (error) {
      setExportError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="See who was marked, by whom and how."
        action={
          <button className={buttonClass} onClick={() => void exportCsv()}>
            <Download className="size-4" aria-hidden />
            Export last 30 days
          </button>
        }
      />
      {exportError && <Message tone="error">{exportError}</Message>}
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Date
            <input
              type="date"
              max={isoDate()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Section
            <select value={sectionId} onChange={(event) => setSelected(event.target.value)} className={inputClass}>
              {sections.data?.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.class.name} - {section.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {roster.isError ? (
          <Message tone="error">{errorText(roster.error)}</Message>
        ) : roster.isLoading || sections.isLoading ? (
          <Message>Loading…</Message>
        ) : !roster.data?.length ? (
          <Message>No students in this section.</Message>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Attendance on {shortDate(date)}</caption>
              <thead className="text-muted">
                <tr>
                  <th className="pb-2 font-semibold">Roll</th>
                  <th className="pb-2 font-semibold">Student</th>
                  <th className="pb-2 font-semibold">Admission no.</th>
                  <th className="pb-2 font-semibold">Marked using</th>
                  <th className="pb-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {roster.data.map((row) => (
                  <tr key={row.enrollmentId} className="border-t border-line">
                    <td className="py-2.5 text-muted">{row.rollNumber ?? '—'}</td>
                    <td className="py-2.5 font-semibold">{fullName(row.student)}</td>
                    <td className="py-2.5 text-muted">{row.student.admissionNo}</td>
                    <td className="py-2.5 text-muted">
                      {row.attendance ? (row.attendance.source === 'NFC' ? 'NFC card' : 'Manual') : '—'}
                    </td>
                    <td className="py-2.5">
                      {row.attendance ? <StatusBadge status={row.attendance.status} /> : <span className="text-muted">Not marked</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
