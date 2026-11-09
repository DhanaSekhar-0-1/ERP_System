import { colors } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Button, Card, Empty, errorText, HeroHeader } from '../../src/ui';

/** The teacher's own subjects and the exams waiting for their marks. */
export default function SubjectsScreen() {
  const router = useRouter();
  const teaching = useQuery({ queryKey: ['my-teaching'], queryFn: api.myTeaching });
  const assessments = useQuery({ queryKey: ['my-assessments'], queryFn: api.myAssessments });
  const refresh = useCallback(() => {
    void teaching.refetch();
    void assessments.refetch();
  }, [teaching, assessments]);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  return (
    <ScrollView
      style={styles.page}
      refreshControl={<RefreshControl refreshing={teaching.isRefetching || assessments.isRefetching} onRefresh={refresh} />}
    >
      <HeroHeader title="My subjects" subtitle={teaching.data?.academicYear ? `For ${teaching.data.academicYear.name}` : undefined} />
      <View style={styles.list}>
        <Text style={styles.heading}>Marks to enter</Text>
        {assessments.isError && <Empty tone="error" text={errorText(assessments.error)} />}
        {assessments.data?.length === 0 && <Empty text="No exams are waiting for your marks." />}
        {assessments.data?.map((item) => (
          <Card key={item.id}>
            <Text style={styles.title}>{item.examination.name}</Text>
            <Text style={styles.meta}>
              {item.subject.name} · {item.class.name}
              {item.section ? `-${item.section.name}` : ''} · out of {item.maxMarks}
            </Text>
            <Text style={styles.meta}>
              {item.entered} entered · {item.submitted} submitted{item.students !== null ? ` of ${item.students}` : ''}
            </Text>
            <Button
              label="Enter marks"
              icon="create-outline"
              style={styles.action}
              onPress={() => router.push({ pathname: '/marks', params: { assessmentId: item.id } })}
            />
          </Card>
        ))}

        <Text style={styles.heading}>Subjects I teach</Text>
        {teaching.isError && <Empty tone="error" text={errorText(teaching.error)} />}
        {teaching.data?.subjects.length === 0 && <Empty text="No subjects assigned yet." />}
        {teaching.data?.subjects.map((item) => (
          <Card key={item.assignmentId}>
            <Text style={styles.title}>{item.subject.name}</Text>
            <Text style={styles.meta}>
              {item.class.name}
              {item.section ? `-${item.section.name}` : ' (all sections)'}
              {item.students !== null ? ` · ${item.students} students` : ''}
            </Text>
          </Card>
        ))}
        {Boolean(teaching.data?.classTeacherOf.length) && (
          <Text style={styles.note}>
            Class teacher of {teaching.data?.classTeacherOf.map((row) => `${row.class.name}-${row.section.name}`).join(', ')}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 12 },
  heading: { fontSize: 13, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', marginTop: 4 },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  meta: { color: colors.muted, marginTop: 3, fontSize: 13 },
  note: { color: colors.primary, fontWeight: '700' },
  action: { marginTop: 12 },
});
