import { colors, fullName, shortDate } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Button, Card, Empty, errorText, HeroHeader } from '../../src/ui';
import { MyLeave } from '../../src/MyLeave';

export default function StaffLeaves() {
  const client = useQueryClient();
  const leaves = useQuery({ queryKey: ['leaves', 'PENDING'], queryFn: () => api.studentLeaves('PENDING') });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => api.decideLeave(id, decision),
    onSuccess: () => client.invalidateQueries(),
  });

  return (
    <ScrollView
      style={styles.page}
      refreshControl={<RefreshControl refreshing={leaves.isRefetching} onRefresh={() => void leaves.refetch()} />}
    >
      <HeroHeader title="Leave" subtitle="Ask the Principal for leave, and decide your students' requests" />
      <View style={styles.list}>
        <MyLeave />
        <Text style={styles.heading}>Student leave requests</Text>
        {leaves.isError && <Empty tone="error" text={errorText(leaves.error)} />}
        {decide.isError && <Empty tone="error" text={errorText(decide.error)} />}
        {leaves.data?.length === 0 && <Empty text="No student requests are waiting." />}
        {leaves.data?.map((leave) => (
          <Card key={leave.id}>
            <Text style={styles.name}>{fullName(leave.student)}</Text>
            <Text style={styles.dates}>
              {shortDate(leave.fromDate)}
              {leave.toDate !== leave.fromDate ? ` to ${shortDate(leave.toDate)}` : ''}
            </Text>
            <Text style={styles.reason}>{leave.reason}</Text>
            <View style={styles.actions}>
              <Button
                label="Reject"
                variant="soft"
                icon="close"
                style={styles.action}
                disabled={decide.isPending}
                onPress={() => decide.mutate({ id: leave.id, decision: 'reject' })}
              />
              <Button
                label="Approve"
                icon="checkmark"
                style={styles.action}
                disabled={decide.isPending}
                onPress={() => decide.mutate({ id: leave.id, decision: 'approve' })}
              />
            </View>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 12 },
  heading: { fontWeight: '800', fontSize: 16, color: colors.ink, marginTop: 10 },
  name: { fontSize: 16, fontWeight: '800', color: colors.ink },
  dates: { color: colors.primary, fontWeight: '700', marginTop: 2 },
  reason: { color: colors.muted, marginTop: 6, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  action: { flex: 1 },
});
