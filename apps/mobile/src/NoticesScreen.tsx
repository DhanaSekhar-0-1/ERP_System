import { Ionicons } from '@expo/vector-icons';
import { colors, shortDate } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { Card, Empty, errorText, HeroHeader } from './ui';

export function NoticesScreen() {
  const notices = useQuery({ queryKey: ['announcements'], queryFn: api.announcements });
  const published = notices.data?.filter((notice) => notice.status === 'PUBLISHED');

  return (
    <ScrollView
      style={styles.page}
      refreshControl={<RefreshControl refreshing={notices.isRefetching} onRefresh={() => void notices.refetch()} />}
    >
      <HeroHeader title="Notices" subtitle="News from your school" />
      <View style={styles.list}>
        {notices.isError && <Empty tone="error" text={errorText(notices.error)} />}
        {published?.length === 0 && <Empty text="No notices yet." />}
        {published?.map((notice) => (
          <Card key={notice.id} style={styles.card}>
            <View style={styles.icon}>
              <Ionicons name="megaphone" size={20} color={colors.accent} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>{notice.title}</Text>
              <Text style={styles.content}>{notice.content}</Text>
              {notice.publishedAt && <Text style={styles.date}>{shortDate(notice.publishedAt)}</Text>}
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
  card: { flexDirection: 'row', gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { fontWeight: '800', fontSize: 15, color: colors.ink },
  content: { color: colors.muted, marginTop: 4, lineHeight: 20 },
  date: { color: colors.muted, fontSize: 12, marginTop: 8 },
});
