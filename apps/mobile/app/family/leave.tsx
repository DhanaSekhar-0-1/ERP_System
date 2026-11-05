import { colors, isoDate, LeaveStatus, shortDate } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useFamilyStudent } from '../../src/family';
import { Button, Card, Empty, errorText, HeroHeader } from '../../src/ui';

const STATUS: Record<LeaveStatus, { color: string; soft: string }> = {
  PENDING: { color: colors.warning, soft: colors.warningSoft },
  APPROVED: { color: colors.success, soft: colors.successSoft },
  REJECTED: { color: colors.danger, soft: colors.dangerSoft },
  CANCELLED: { color: colors.muted, soft: colors.line },
};

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export default function FamilyLeave() {
  const client = useQueryClient();
  const { studentId } = useFamilyStudent();
  const [fromDate, setFromDate] = useState(isoDate());
  const [toDate, setToDate] = useState(isoDate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const leaves = useQuery({ queryKey: ['leaves', 'mine'], queryFn: () => api.studentLeaves() });

  const request = useMutation({
    mutationFn: () => api.requestLeave({ studentId: studentId as string, fromDate, toDate, reason: reason.trim() }),
    onSuccess: async () => {
      setReason('');
      await client.invalidateQueries({ queryKey: ['leaves'] });
    },
    onError: (failure) => setError(errorText(failure)),
  });

  const submit = () => {
    setError('');
    if (!isDate(fromDate) || !isDate(toDate)) return setError('Enter dates as YYYY-MM-DD');
    if (toDate < fromDate) return setError('The end date cannot be before the start date');
    if (reason.trim().length < 3) return setError('Please give a reason');
    request.mutate();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={leaves.isRefetching} onRefresh={() => void leaves.refetch()} />}
      >
        <HeroHeader title="Leave" subtitle="Ask your class teacher for leave" />
        <View style={styles.content}>
          <Card>
            <View style={styles.dates}>
              <View style={styles.dateField}>
                <Text style={styles.label}>From</Text>
                <TextInput value={fromDate} onChangeText={setFromDate} accessibilityLabel="From date" placeholder="YYYY-MM-DD" style={styles.input} />
              </View>
              <View style={styles.dateField}>
                <Text style={styles.label}>To</Text>
                <TextInput value={toDate} onChangeText={setToDate} accessibilityLabel="To date" placeholder="YYYY-MM-DD" style={styles.input} />
              </View>
            </View>
            <Text style={styles.label}>Reason</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              accessibilityLabel="Reason"
              style={[styles.input, styles.reason]}
            />
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Button label="Send request" icon="send" busy={request.isPending} disabled={!studentId} onPress={submit} />
          </Card>

          <Text style={styles.heading}>Your requests</Text>
          {leaves.isError && <Empty tone="error" text={errorText(leaves.error)} />}
          {leaves.data?.length === 0 && <Empty text="No leave requests yet." />}
          {leaves.data?.map((leave) => (
            <Card key={leave.id} style={styles.item}>
              <View style={styles.itemBody}>
                <Text style={styles.itemDates}>
                  {shortDate(leave.fromDate)}
                  {leave.toDate !== leave.fromDate ? ` to ${shortDate(leave.toDate)}` : ''}
                </Text>
                <Text style={styles.itemReason}>{leave.reason}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: STATUS[leave.status].soft }]}>
                <Text style={[styles.pillText, { color: STATUS[leave.status].color }]}>
                  {leave.status[0] + leave.status.slice(1).toLowerCase()}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12 },
  dates: { flexDirection: 'row', gap: 10 },
  dateField: { flex: 1 },
  label: { fontWeight: '700', color: colors.ink, fontSize: 13, marginBottom: 6 },
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
  reason: { minHeight: 76, textAlignVertical: 'top' },
  error: { color: colors.danger, fontWeight: '600', marginBottom: 10 },
  heading: { fontWeight: '800', fontSize: 16, color: colors.ink, marginTop: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemBody: { flex: 1 },
  itemDates: { fontWeight: '800', color: colors.ink },
  itemReason: { color: colors.muted, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  pillText: { fontSize: 11, fontWeight: '800' },
});
