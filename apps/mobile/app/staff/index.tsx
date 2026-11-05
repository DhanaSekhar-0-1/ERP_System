import { colors, isoDate, MySection } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { Button, Card, Empty, errorText, HeroHeader } from '../../src/ui';

function SectionCard({ section }: { section: MySection }) {
  const router = useRouter();
  const percent = section.students ? (section.marked / section.students) * 100 : 0;
  const done = section.students > 0 && section.marked >= section.students;
  const params = { sectionId: section.id, title: `${section.class.name} - ${section.name}` };

  return (
    <Card>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>
          {section.class.name} - {section.name}
        </Text>
        <View style={[styles.pill, { backgroundColor: done ? colors.successSoft : colors.warningSoft }]}>
          <Text style={[styles.pillText, { color: done ? colors.success : colors.warning }]}>
            {done ? 'Completed' : section.marked ? 'In progress' : 'Not started'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>
        {section.marked} of {section.students} marked · {section.attended} present
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: done ? colors.success : colors.primary }]} />
      </View>
      <View style={styles.actions}>
        <Button
          label="Tap cards"
          icon="radio-outline"
          style={styles.action}
          onPress={() => router.push({ pathname: '/scan', params })}
        />
        <Button
          label="Mark list"
          icon="list"
          variant="soft"
          style={styles.action}
          onPress={() => router.push({ pathname: '/mark', params })}
        />
      </View>
    </Card>
  );
}

export default function StaffHome() {
  const { user } = useAuth();
  const date = isoDate();
  const sections = useQuery({ queryKey: ['sections', date], queryFn: () => api.mySections(date) });
  const refetch = sections.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const remaining = sections.data?.reduce((sum, section) => sum + section.students - section.marked, 0) ?? 0;

  return (
    <ScrollView
      style={styles.page}
      refreshControl={<RefreshControl refreshing={sections.isRefetching} onRefresh={() => void refetch()} />}
    >
      <HeroHeader
        title={`Hello, ${user?.displayName.split(' ')[0] ?? ''}`}
        subtitle={remaining ? `${remaining} students still to mark today` : 'Attendance is complete for today'}
      />
      <View style={styles.list}>
        {sections.isError && <Empty tone="error" text={errorText(sections.error)} />}
        {sections.data?.length === 0 && <Empty text="You are not assigned to any section yet." />}
        {sections.data?.map((section) => <SectionCard key={section.id} section={section} />)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  pillText: { fontSize: 11, fontWeight: '800' },
  cardMeta: { color: colors.muted, marginTop: 4, fontSize: 13 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.line, marginTop: 12, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  action: { flex: 1 },
});
