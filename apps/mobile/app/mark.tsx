import { Ionicons } from '@expo/vector-icons';
import { AttendanceStatus, colors, fullName, isoDate, statusStyles } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { Button, Empty, errorText } from '../src/ui';

const CHOICES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE'];

export default function MarkScreen() {
  const { sectionId, title } = useLocalSearchParams<{ sectionId: string; title: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const date = isoDate();
  const [changes, setChanges] = useState<Record<string, AttendanceStatus>>({});
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');

  const roster = useQuery({
    queryKey: ['roster', sectionId, date],
    queryFn: () => api.sectionAttendance(sectionId, date),
  });

  const pending = useMemo(
    () =>
      (roster.data ?? []).flatMap((row) => {
        const status = changes[row.enrollmentId];
        return status && status !== row.attendance?.status ? [{ row, status }] : [];
      }),
    [changes, roster.data],
  );
  /** The API requires a reason for changing a saved record. */
  const needsReason = pending.some(({ row }) => row.attendance);

  const save = useMutation({
    mutationFn: () =>
      api.markBulk(
        date,
        pending.map(({ row, status }) => ({ enrollmentId: row.enrollmentId, status })),
        needsReason ? reason.trim() : undefined,
      ),
    onSuccess: async (result) => {
      await client.invalidateQueries();
      if (result.failed) {
        setFailure(result.results.find((item) => item.error)?.error ?? `${result.failed} records were not saved`);
        return;
      }
      router.back();
    },
    onError: (error) => setFailure(errorText(error)),
  });

  const markAllPresent = () => {
    const next = { ...changes };
    roster.data?.forEach((row) => {
      if (!row.attendance) next[row.enrollmentId] = 'PRESENT';
    });
    setChanges(next);
  };

  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={markAllPresent} accessibilityRole="button" hitSlop={10}>
          <Text style={styles.allPresent}>All present</Text>
        </Pressable>
      </View>

      <FlatList
        data={roster.data ?? []}
        keyExtractor={(row) => row.enrollmentId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          roster.isError ? (
            <Empty tone="error" text={errorText(roster.error)} />
          ) : roster.isLoading ? (
            <Empty text="Loading students…" />
          ) : (
            <Empty text="No students in this section." />
          )
        }
        renderItem={({ item }) => {
          const current = changes[item.enrollmentId] ?? item.attendance?.status;
          return (
            <View style={styles.row}>
              <View style={styles.rowName}>
                <Text style={styles.name} numberOfLines={1}>
                  {fullName(item.student)}
                </Text>
                <Text style={styles.meta}>
                  Roll {item.rollNumber ?? '—'}
                  {item.attendance?.source === 'NFC' ? ' · NFC' : ''}
                </Text>
              </View>
              {current === 'ON_LEAVE' || current === 'EXCUSED' ? (
                <Text style={[styles.locked, { color: statusStyles[current].color }]}>{statusStyles[current].label}</Text>
              ) : (
                <View style={styles.choices}>
                  {CHOICES.map((status) => {
                    const style = statusStyles[status];
                    const active = current === status;
                    return (
                      <Pressable
                        key={status}
                        onPress={() => setChanges({ ...changes, [item.enrollmentId]: status })}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${fullName(item.student)} ${style.label}`}
                        style={[styles.choice, active && { backgroundColor: style.color, borderColor: style.color }]}
                      >
                        <Text style={[styles.choiceText, active && styles.choiceActive]}>{style.short}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {needsReason && (
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason for changing saved attendance"
            accessibilityLabel="Reason for changing saved attendance"
            placeholderTextColor={colors.muted}
            style={styles.reason}
          />
        )}
        {failure ? (
          <Text accessibilityRole="alert" style={styles.failure}>
            {failure}
          </Text>
        ) : null}
        <Button
          label={pending.length ? `Save ${pending.length} ${pending.length === 1 ? 'student' : 'students'}` : 'No changes'}
          busy={save.isPending}
          disabled={!pending.length || (needsReason && reason.trim().length < 3)}
          onPress={() => {
            setFailure('');
            save.mutate();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.ink },
  allPresent: { color: colors.primary, fontWeight: '800' },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  rowName: { flex: 1 },
  name: { fontWeight: '700', color: colors.ink, fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 1 },
  locked: { fontWeight: '800', fontSize: 13 },
  choices: { flexDirection: 'row', gap: 6 },
  choice: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontWeight: '800', color: colors.muted },
  choiceActive: { color: '#fff' },
  footer: { backgroundColor: '#fff', padding: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  reason: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.ink,
  },
  failure: { color: colors.danger, fontWeight: '600' },
});
