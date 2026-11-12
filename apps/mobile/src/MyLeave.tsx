import { colors, isoDate, LeaveSession, LeaveStatus, shortDate, StaffLeave, StaffLeaveType } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from './api';
import { useAuth } from './auth';
import { Button, Card, Empty, errorText } from './ui';

const TYPES: { value: StaffLeaveType; label: string }[] = [
  { value: 'CASUAL', label: 'Casual' },
  { value: 'SICK', label: 'Sick' },
  { value: 'EARNED', label: 'Earned' },
  { value: 'UNPAID', label: 'Unpaid' },
];
const SESSIONS: { value: LeaveSession; label: string }[] = [
  { value: 'FULL_DAY', label: 'Full day' },
  { value: 'MORNING', label: 'Morning half' },
  { value: 'AFTERNOON', label: 'Afternoon half' },
];
const STATUS: Record<LeaveStatus, { label: string; color: string; soft: string }> = {
  PENDING: { label: 'Waiting', color: colors.warning, soft: colors.warningSoft },
  APPROVED: { label: 'Approved', color: colors.success, soft: colors.successSoft },
  REJECTED: { label: 'Rejected', color: colors.danger, soft: colors.dangerSoft },
  CANCELLED: { label: 'Cancelled', color: colors.muted, soft: colors.line },
};
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange(value: T): void }) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function describe(leave: StaffLeave) {
  const from = leave.fromDate.slice(0, 10);
  const to = leave.toDate.slice(0, 10);
  const range = from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`;
  const half = leave.session === 'MORNING' ? ' · Morning half' : leave.session === 'AFTERNOON' ? ' · Afternoon half' : '';
  const type = TYPES.find((t) => t.value === leave.leaveType)?.label ?? leave.leaveType;
  return `${type} · ${range}${half}`;
}

/** The teacher asks the Principal for leave, with a morning or afternoon half day for one date. */
export function MyLeave() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [leaveType, setLeaveType] = useState<StaffLeaveType>('CASUAL');
  const [session, setSession] = useState<LeaveSession>('FULL_DAY');
  const [fromDate, setFromDate] = useState(isoDate());
  const [toDate, setToDate] = useState(isoDate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const single = fromDate === toDate;
  const mine = useQuery({
    queryKey: ['my-staff-leaves'],
    queryFn: () => api.staffLeaves({ staffId: user?.staffId ?? undefined }),
    enabled: Boolean(user?.staffId),
  });
  const request = useMutation({
    mutationFn: () =>
      api.requestStaffLeave({ leaveType, fromDate, toDate, session: single ? session : 'FULL_DAY', reason: reason.trim() }),
    onSuccess: async () => {
      setReason('');
      setSent(true);
      await client.invalidateQueries({ queryKey: ['my-staff-leaves'] });
    },
    onError: (failure) => setError(errorText(failure)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelStaffLeave(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-staff-leaves'] }),
    onError: (failure) => setError(errorText(failure)),
  });
  const submit = () => {
    setError('');
    setSent(false);
    if (!isDate(fromDate) || !isDate(toDate)) return setError('Enter dates as YYYY-MM-DD');
    if (toDate < fromDate) return setError('The end date cannot be before the start date');
    if (reason.trim().length < 3) return setError('Please give a reason');
    request.mutate();
  };

  return (
    <>
      <Card>
        <Text style={styles.title}>Ask for leave</Text>
        <Text style={styles.label}>Type</Text>
        <Chips<StaffLeaveType> options={TYPES} value={leaveType} onChange={setLeaveType} />
        <View style={styles.dates}>
          <View style={styles.dateField}>
            <Text style={styles.label}>From</Text>
            <TextInput value={fromDate} onChangeText={setFromDate} accessibilityLabel="Leave from date" placeholder="YYYY-MM-DD" style={styles.input} />
          </View>
          <View style={styles.dateField}>
            <Text style={styles.label}>To</Text>
            <TextInput value={toDate} onChangeText={setToDate} accessibilityLabel="Leave to date" placeholder="YYYY-MM-DD" style={styles.input} />
          </View>
        </View>
        {single && (
          <>
            <Text style={styles.label}>How much of the day</Text>
            <Chips<LeaveSession> options={SESSIONS} value={session} onChange={setSession} />
          </>
        )}
        <Text style={styles.label}>Reason</Text>
        <TextInput value={reason} onChangeText={setReason} multiline accessibilityLabel="Leave reason" style={[styles.input, styles.reason]} />
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {sent ? <Text style={styles.sent}>Sent. The Principal will decide.</Text> : null}
        <Button label="Send to Principal" icon="send" busy={request.isPending} onPress={submit} />
      </Card>

      <Text style={styles.heading}>My leave</Text>
      {mine.isError && <Empty tone="error" text={errorText(mine.error)} />}
      {mine.data?.length === 0 && <Empty text="No leave requests yet." />}
      {mine.data?.map((leave) => (
        <Card key={leave.id} style={styles.item}>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle}>{describe(leave)}</Text>
            <Text style={styles.itemReason}>{leave.reason}</Text>
            {leave.decisionNote ? <Text style={styles.itemNote}>Principal: {leave.decisionNote}</Text> : null}
            {leave.status === 'PENDING' ? (
              <Pressable accessibilityRole="button" onPress={() => cancel.mutate(leave.id)} disabled={cancel.isPending}>
                <Text style={styles.cancel}>Cancel request</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.pill, { backgroundColor: STATUS[leave.status].soft }]}>
            <Text style={[styles.pillText, { color: STATUS[leave.status].color }]}>{STATUS[leave.status].label}</Text>
          </View>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  label: { fontWeight: '700', color: colors.ink, fontSize: 13, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontWeight: '700', color: colors.ink, fontSize: 13 },
  chipTextOn: { color: '#fff' },
  dates: { flexDirection: 'row', gap: 10 },
  dateField: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    marginBottom: 12,
    minWidth: 0,
  },
  reason: { minHeight: 70, textAlignVertical: 'top' },
  error: { color: colors.danger, fontWeight: '600', marginBottom: 10 },
  sent: { color: colors.success, fontWeight: '700', marginBottom: 10 },
  heading: { fontWeight: '800', fontSize: 16, color: colors.ink, marginTop: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemBody: { flex: 1 },
  itemTitle: { fontWeight: '800', color: colors.ink },
  itemReason: { color: colors.muted, marginTop: 2 },
  itemNote: { color: colors.ink, marginTop: 4 },
  cancel: { color: colors.danger, fontWeight: '700', marginTop: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  pillText: { fontSize: 11, fontWeight: '800' },
});
