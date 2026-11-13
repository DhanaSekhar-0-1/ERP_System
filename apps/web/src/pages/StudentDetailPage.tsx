import { shortDate } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Card, errorText, Message, PageHeader } from '../components/ui';

const pct = (value: number | null) => (value === null ? '—' : `${value}%`);
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 border-t border-line py-2 text-sm first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** One student's details and attendance, month by month, for each year at the school. */
export function StudentDetailPage() {
  const { studentId = '' } = useParams();
  const profile = useQuery({
    queryKey: ['student-profile', studentId],
    queryFn: () => api.studentAttendanceProfile(studentId),
    enabled: Boolean(studentId),
  });
  const data = profile.data;
  const current = data?.years.find((year) => year.academicYear.isActive) ?? data?.years[0];
  const name = data ? [data.firstName, data.lastName].filter(Boolean).join(' ') : 'Student';

  return (
    <>
      <Link to="/attendance" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Attendance
      </Link>
      <PageHeader
        title={name}
        subtitle={data ? `${data.admissionNo}${current ? ` · ${current.label} · roll ${current.rollNumber ?? '—'}` : ''}${data.isArchived ? ' · Archived' : ''}` : undefined}
      />
      {profile.isLoading && <Message>Loading…</Message>}
      {profile.isError && <Message tone="error">{errorText(profile.error)}</Message>}
      {data && (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <Card title="Details">
            <dl>
              <Row label="Gender">{data.gender ? data.gender.charAt(0) + data.gender.slice(1).toLowerCase() : '—'}</Row>
              <Row label="Date of birth">{data.dateOfBirth ? shortDate(data.dateOfBirth.slice(0, 10)) : '—'}</Row>
              <Row label="Admitted">
                {data.admissionDate ? shortDate(data.admissionDate.slice(0, 10)) : '—'}
                {data.admissionType === 'NEW_TO_SCHOOL' ? ' (new to the school)' : ''}
              </Row>
              <Row label="Aadhaar">{data.aadhaarMasked ?? (data.aadhaarEnrolmentNo ? 'Applied for (slip on file)' : '—')}</Row>
              <Row label="Blood group">{data.bloodGroup ?? '—'}</Row>
              <Row label="NFC card">{data.nfcId ?? '—'}</Row>
              <Row label="Address">{data.address ?? '—'}</Row>
              {data.guardians.map((link, index) => (
                <Row key={index} label={link.isPrimary ? 'Parent' : 'Other parent'}>
                  {link.guardian.name}
                  {link.guardian.relation ? ` (${link.guardian.relation})` : ''}
                  {link.guardian.phone ? <span className="block text-muted">{link.guardian.phone}</span> : null}
                </Row>
              ))}
            </dl>
          </Card>
          <div className="grid gap-6">
            {data.years.length === 0 && (
              <Card title="Attendance">
                <Message>Not in any class yet.</Message>
              </Card>
            )}
            {data.years.map((year) => (
              <Card key={year.academicYear.id} title={`${year.label} · ${year.academicYear.name}`}>
                <p className="mb-3 text-sm">
                  <span className={`text-2xl font-extrabold tabular-nums ${year.overall.percent !== null && year.overall.percent < 75 ? 'text-red-600' : ''}`}>
                    {pct(year.overall.percent)}
                  </span>{' '}
                  <span className="text-muted">
                    {year.overall.present + year.overall.late} of {year.overall.present + year.overall.late + year.overall.absent} school days
                    {year.overall.onLeave ? ` · ${year.overall.onLeave} on leave` : ''}
                  </span>
                </p>
                {year.months.length === 0 ? (
                  <Message>No attendance marked yet.</Message>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-left text-sm">
                      <thead className="text-muted">
                        <tr>
                          <th className="pb-2 font-semibold">Month</th>
                          <th className="pb-2 font-semibold">Present</th>
                          <th className="pb-2 font-semibold">Late</th>
                          <th className="pb-2 font-semibold">Absent</th>
                          <th className="pb-2 font-semibold">On leave</th>
                          <th className="pb-2 font-semibold">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {year.months.map((month) => (
                          <tr key={month.month} className="border-t border-line tabular-nums">
                            <td className="py-2 font-semibold">{monthName(month.month)}</td>
                            <td className="py-2 text-emerald-700">{month.present}</td>
                            <td className="py-2 text-amber-700">{month.late}</td>
                            <td className="py-2 text-red-600">{month.absent}</td>
                            <td className="py-2 text-sky-700">{month.onLeave}</td>
                            <td className="py-2 font-bold">{pct(month.percent)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
