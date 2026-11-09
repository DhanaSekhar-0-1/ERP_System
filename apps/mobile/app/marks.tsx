import { Ionicons } from '@expo/vector-icons';
import { colors, fullName } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { Button, Empty, errorText } from '../src/ui';

type Entry = { marks: string; absent: boolean };

/** Enter, save and submit marks for one exam subject the teacher teaches. */
export default function MarksScreen() {
  const { assessmentId } = useLocalSearchParams<{ assessmentId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const sheet = useQuery({ queryKey: ['mark-sheet', assessmentId], queryFn: () => api.markSheet(assessmentId) });
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!sheet.data) return;
    const next: Record<string, Entry> = {};
    sheet.data.students.forEach((row) => {
      next[row.student.id] = { marks: row.mark?.marksObtained?.toString() ?? '', absent: row.mark?.isAbsent ?? false };
    });
    setEntries(next);
  }, [sheet.data]);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['mark-sheet', assessmentId] });
    await client.invalidateQueries({ queryKey: ['my-assessments'] });
  };
  const saveMarks = () =>
      api.saveMarks(
        assessmentId,
        (sheet.data?.students ?? [])
          .filter((row) => row.mark?.status !== 'SUBMITTED')
          .map((row) => ({ id: row.student.id, entry: entries[row.student.id] }))
          .filter(({ entry }) => entry && (entry.absent || entry.marks !== ''))
          .map(({ id, entry }) => (entry.absent ? { studentId: id, isAbsent: true } : { studentId: id, marksObtained: Number(entry.marks) })),
      );
  const save = useMutation({
    mutationFn: saveMarks,
    onSuccess: async () => {
      setMessage('Saved');
      await refresh();
    },
    onError: (error) => setMessage(errorText(error)),
  });
  // Submitting always saves what is on screen first, so nothing typed is lost.
  const submit = useMutation({
    mutationFn: async () => {
      await saveMarks();
      return api.submitMarks(assessmentId);
    },
    onSuccess: async () => {
      setMessage('Submitted for approval');
      await refresh();
    },
    onError: (error) => setMessage(errorText(error)),
  });

  const data = sheet.data;
  const allSubmitted = data ? data.students.length > 0 && data.students.every((row) => row.mark?.status === 'SUBMITTED') : false;

  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.ink} />
        </Pressable>
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {data ? `${data.assessment.examination.name} · ${data.assessment.subject.name}` : 'Marks'}
          </Text>
          {data && (
            <Text style={styles.meta}>
              {data.assessment.class.name}
              {data.assessment.section ? `-${data.assessment.section.name}` : ''} · out of {data.assessment.maxMarks}
            </Text>
          )}
        </View>
      </View>
      {sheet.isError && <Empty tone="error" text={errorText(sheet.error)} />}
      <FlatList
        data={data?.students ?? []}
        keyExtractor={(row) => row.student.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={sheet.isLoading ? undefined : <Empty text="No students in this class." />}
        renderItem={({ item: row }) => {
          const entry = entries[row.student.id] ?? { marks: '', absent: false };
          const locked = row.mark?.status === 'SUBMITTED';
          return (
            <View style={styles.row}>
              <View style={styles.rowName}>
                <Text style={styles.name}>{fullName(row.student)}</Text>
                <Text style={styles.meta}>
                  {row.section}
                  {row.rollNumber ? ` · Roll ${row.rollNumber}` : ''}
                  {locked ? ' · Submitted' : ''}
                </Text>
              </View>
              <TextInput
                accessibilityLabel={`Marks for ${fullName(row.student)}`}
                keyboardType="decimal-pad"
                editable={!locked && !entry.absent}
                value={entry.marks}
                onChangeText={(text) => setEntries((all) => ({ ...all, [row.student.id]: { ...entry, marks: text } }))}
                style={[styles.input, (locked || entry.absent) && styles.inputOff]}
              />
              <Pressable
                disabled={locked}
                onPress={() => setEntries((all) => ({ ...all, [row.student.id]: { ...entry, absent: !entry.absent } }))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: entry.absent, disabled: locked }}
                style={[styles.absent, entry.absent && styles.absentOn]}
              >
                <Text style={[styles.absentText, entry.absent && { color: '#fff' }]}>Absent</Text>
              </Pressable>
            </View>
          );
        }}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.actions}>
          <Button label="Save" variant="soft" style={styles.action} busy={save.isPending} disabled={allSubmitted || submit.isPending} onPress={() => save.mutate()} />
          <Button
            label={allSubmitted ? 'Submitted' : 'Submit'}
            icon="send"
            style={styles.action}
            busy={submit.isPending}
            disabled={allSubmitted || save.isPending}
            onPress={() => submit.mutate()}
          />
        </View>
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
  titleBox: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  rowName: { flex: 1 },
  name: { fontWeight: '700', color: colors.ink, fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 1 },
  input: {
    width: 64,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: 'center',
    fontSize: 16,
    color: colors.ink,
  },
  inputOff: { backgroundColor: colors.background, color: colors.muted },
  absent: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  absentOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  absentText: { fontSize: 12, fontWeight: '800', color: colors.muted },
  footer: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  message: { textAlign: 'center', color: colors.muted, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
