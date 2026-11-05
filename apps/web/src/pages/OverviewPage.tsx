import { colors, daysAgo, fullName, isoDate, longToday, shortDate } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, Clock, LucideIcon, ShieldCheck, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, errorText, Message, PageHeader } from '../components/ui';

function Kpi({ label, value, note, icon: Icon, tint }: { label: string; value: string; note: string; icon: LucideIcon; tint: string }) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-muted">{label}</p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted">{note}</p>
      </div>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${tint}1a`, color: tint }}>
        <Icon className="size-6" aria-hidden />
      </span>
    </Card>
  );
}

export function OverviewPage() {
  const { user } = useAuth();
  const today = isoDate();
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: api.principalDashboard, refetchInterval: 15_000 });
  const trend = useQuery({ queryKey: ['trend'], queryFn: () => api.attendanceTrend(daysAgo(63), today) });
  const risk = useQuery({ queryKey: ['risk'], queryFn: api.attendanceRisk });
  const sections = useQuery({
    queryKey: ['sections', today],
    queryFn: () => api.mySections(today),
    refetchInterval: 15_000,
  });

  if (dashboard.isError) return <Message tone="error">{errorText(dashboard.error)}</Message>;
  const data = dashboard.data;
  const attendance = data?.attendanceToday;

  return (
    <>
      <PageHeader title={`Good day, ${user?.displayName ?? ''}`} subtitle={longToday()} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Attendance today"
          value={attendance?.rate == null ? '—' : `${attendance.rate}%`}
          note={`${attendance?.marked ?? 0} of ${data?.students ?? 0} students marked`}
          icon={CalendarCheck}
          tint={colors.success}
        />
        <Kpi
          label="Absent today"
          value={String(attendance?.ABSENT ?? 0)}
          note={`${attendance?.LATE ?? 0} arrived late`}
          icon={Clock}
          tint={colors.danger}
        />
        <Kpi
          label="Students"
          value={String(data?.students ?? '—')}
          note={`${data?.activeStaff ?? 0} active staff`}
          icon={Users}
          tint={colors.primary}
        />
        <Kpi
          label="Waiting on you"
          value={String((data?.pendingApprovals ?? 0) + (data?.pendingStudentLeaves ?? 0))}
          note={`Approvals: ${data?.pendingApprovals ?? 0} · Leave: ${data?.pendingStudentLeaves ?? 0}`}
          icon={ShieldCheck}
          tint={colors.accent}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Attendance rate by week" className="lg:col-span-2">
          <div className="h-72">
            {trend.data?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data} margin={{ left: -16, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="rate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.primary} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={colors.line} />
                  <XAxis dataKey="weekOf" tickFormatter={shortDate} tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis domain={[0, 100]} unit="%" tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip formatter={(value) => [`${String(value)}%`, 'Attendance']} labelFormatter={(label) => `Week of ${shortDate(String(label))}`} />
                  <Area isAnimationActive={false} type="monotone" dataKey="rate" stroke={colors.primary} strokeWidth={3} fill="url(#rate)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Message>{trend.isLoading ? 'Loading…' : 'No attendance recorded yet.'}</Message>
            )}
          </div>
        </Card>

        <Card title="Classes today">
          <ul className="space-y-4">
            {sections.data?.map((section) => {
              const percent = section.students ? Math.round((section.marked / section.students) * 100) : 0;
              return (
                <li key={section.id}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-semibold">
                      {section.class.name} - {section.name}
                    </span>
                    <span className="text-muted">
                      {section.marked === 0 ? 'Not started' : `${section.attended}/${section.marked} present`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand to-indigo-400 transition-all" style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            })}
            {sections.data?.length === 0 && <Message>No sections in the active year.</Message>}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="mb-4 flex items-center gap-2 font-bold">
          <AlertTriangle className="size-5 text-amber-500" aria-hidden />
          Students needing attention
          <span className="text-sm font-medium text-muted">below {risk.data?.threshold ?? 75}% in the last 60 days</span>
        </h2>
        {risk.data?.students.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-96 text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="pb-2 font-semibold">Student</th>
                  <th className="pb-2 font-semibold">Class</th>
                  <th className="pb-2 text-right font-semibold">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {risk.data.students.slice(0, 8).map((row) => (
                  <tr key={row.enrollmentId} className="border-t border-line">
                    <td className="py-2.5 font-semibold">{row.student ? fullName(row.student) : '—'}</td>
                    <td className="py-2.5 text-muted">
                      {row.class?.name} - {row.section?.name}
                    </td>
                    <td className="py-2.5 text-right font-bold text-red-600">{row.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Message>{risk.isLoading ? 'Loading…' : 'No students are below the threshold.'}</Message>
        )}
      </Card>
    </>
  );
}
