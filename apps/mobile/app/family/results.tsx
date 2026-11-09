import { colors } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useFamilyStudent } from '../../src/family';
import { Card, Empty, errorText, HeroHeader } from '../../src/ui';

/** Report cards for exams whose results have been released for the student's section. */
export default function FamilyResults() {
  const { studentId, label } = useFamilyStudent();
  const cards = useQuery({
    queryKey: ['report-cards', studentId],
    queryFn: () => api.reportCards(studentId as string),
    enabled: Boolean(studentId),
  });
  const refetch = cards.refetch;
  useFocusEffect(
    useCallback(() => {
      if (studentId) void refetch();
    }, [refetch, studentId]),
  );

  return (
    <ScrollView style={styles.page} refreshControl={<RefreshControl refreshing={cards.isRefetching} onRefresh={() => void refetch()} />}>
      <HeroHeader title="Results" subtitle={label ? `For ${label}` : 'Released exam results'} />
      <View style={styles.list}>
        {cards.isError && <Empty tone="error" text={errorText(cards.error)} />}
        {cards.data?.length === 0 && <Empty text="No results have been released yet." />}
        {cards.data?.map((card) => (
          <Card key={card.examination.id}>
            <View style={styles.top}>
              <Text style={styles.title}>{card.examination.name}</Text>
              <View style={styles.grade}>
                <Text style={styles.gradeText}>{card.grade}</Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {card.total} / {card.maxTotal} · {card.percent}% · {card.result === 'PASS' ? 'Passed' : 'Needs improvement'}
            </Text>
            {card.subjects.map((subject) => (
              <View key={subject.subject.id} style={styles.row}>
                <Text style={styles.subject}>{subject.subject.name}</Text>
                <Text style={[styles.mark, !subject.passed && { color: colors.danger }]}>
                  {subject.isAbsent ? 'Absent' : `${subject.marksObtained} / ${subject.maxMarks}`}
                </Text>
                <Text style={styles.subjectGrade}>{subject.grade}</Text>
              </View>
            ))}
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 12 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  grade: { backgroundColor: colors.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  gradeText: { color: colors.primary, fontWeight: '800' },
  meta: { color: colors.muted, marginTop: 4, marginBottom: 8, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line },
  subject: { flex: 1, color: colors.ink, fontWeight: '600' },
  mark: { color: colors.ink, fontWeight: '700' },
  subjectGrade: { width: 32, textAlign: 'right', color: colors.muted, fontWeight: '700' },
});
