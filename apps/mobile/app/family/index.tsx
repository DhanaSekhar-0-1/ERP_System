import { Ionicons } from '@expo/vector-icons';
import { AttendanceStatus, colors, isoDate, statusStyles } from '@erp/shared';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useFamilyStudent } from '../../src/family';
import { Card, Empty, errorText, HeroHeader } from '../../src/ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function Ring({ percent }: { percent: number | null }) {
  const size = 132;
  const stroke = 13;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = percent ?? 0;
  return (
    <View style={styles.ring} accessibilityRole="image" accessibilityLabel={percent === null ? 'No attendance yet' : `${percent} percent attendance`}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#FCD34D"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${(shown / 100) * circumference} ${circumference}`}
        />
      </Svg>
      <View style={styles.ringLabel}>
        <Text style={styles.ringValue}>{percent === null ? '—' : `${percent}%`}</Text>
        <Text style={styles.ringCaption}>this month</Text>
      </View>
    </View>
  );
}

export default function FamilyHome() {
  const { user } = useAuth();
  const { studentId, label, isParent } = useFamilyStudent();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const from = isoDate(month);
  const to = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const today = isoDate();
  const isCurrentMonth = from.slice(0, 7) === today.slice(0, 7);

  const attendance = useQuery({
    queryKey: ['my-attendance', studentId, from],
    queryFn: () => api.studentAttendance(studentId as string, from, to),
    enabled: Boolean(studentId),
  });
  const refetch = attendance.refetch;
  useFocusEffect(
    useCallback(() => {
      if (studentId) void refetch();
    }, [refetch, studentId]),
  );

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceStatus>();
    attendance.data?.items.forEach((record) => map.set(record.attendanceDate.slice(0, 10), record.status));
    return map;
  }, [attendance.data]);

  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, ON_LEAVE: 0, EXCUSED: 0 };
  byDate.forEach((status) => {
    counts[status] += 1;
  });
  const rate = byDate.size ? Math.round(((counts.PRESENT + counts.LATE) / byDate.size) * 100) : null;
  const todayStatus = byDate.get(today);

  const blanks = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const name = label ?? user?.displayName.split(' ')[0] ?? '';

  return (
    <ScrollView
      style={styles.page}
      refreshControl={<RefreshControl refreshing={attendance.isRefetching} onRefresh={() => void refetch()} />}
    >
      <HeroHeader title={isParent ? name : `Hi, ${name}!`} subtitle={isParent ? 'Your child’s attendance' : 'Your attendance this month'}>
        <View style={styles.heroBody}>
          <Ring percent={rate} />
          <View style={styles.today}>
            <Text style={styles.todayLabel}>Today</Text>
            <Text style={styles.todayValue}>{todayStatus ? statusStyles[todayStatus].label : 'Not marked yet'}</Text>
          </View>
        </View>
      </HeroHeader>

      <View style={styles.content}>
        {!studentId && !attendance.isLoading && <Empty text="No student is linked to this account yet." />}
        {attendance.isError && <Empty tone="error" text={errorText(attendance.error)} />}

        <View style={styles.stats}>
          {(['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE'] as const).map((status) => (
            <View key={status} style={[styles.stat, { backgroundColor: statusStyles[status].soft }]}>
              <Text style={[styles.statValue, { color: statusStyles[status].color }]}>{counts[status]}</Text>
              <Text style={styles.statLabel}>{statusStyles[status].label}</Text>
            </View>
          ))}
        </View>

        <Card>
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={22} color={colors.ink} />
            </Pressable>
            <Text style={styles.monthName}>
              {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </Text>
            <Pressable
              onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              disabled={isCurrentMonth}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              hitSlop={10}
            >
              <Ionicons name="chevron-forward" size={22} color={isCurrentMonth ? colors.line : colors.ink} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {WEEKDAYS.map((day, index) => (
              <Text key={index} style={styles.weekday}>
                {day}
              </Text>
            ))}
            {Array.from({ length: blanks }, (_, index) => (
              <View key={`blank-${index}`} style={styles.cell} />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const value = `${from.slice(0, 8)}${String(day).padStart(2, '0')}`;
              const status = byDate.get(value);
              const style = status ? statusStyles[status] : null;
              return (
                <View key={day} style={styles.cell} accessibilityLabel={`${day}: ${style?.label ?? 'not marked'}`}>
                  <View style={[styles.day, style && { backgroundColor: style.soft }, value === today && styles.dayToday]}>
                    <Text style={[styles.dayText, style && { color: style.color, fontWeight: '800' }]}>{day}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  heroBody: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 18 },
  ring: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { position: 'absolute', alignItems: 'center' },
  ringValue: { color: '#fff', fontSize: 30, fontWeight: '800' },
  ringCaption: { color: '#C7D2FE', fontSize: 11 },
  today: { flex: 1, backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 18, padding: 14 },
  todayLabel: { color: '#C7D2FE', fontSize: 12, fontWeight: '600' },
  todayValue: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 3 },
  content: { padding: 16, gap: 12 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: '600' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthName: { fontWeight: '800', color: colors.ink, fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: colors.muted, fontWeight: '700', fontSize: 12, paddingBottom: 6 },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 2, borderColor: colors.primary },
  dayText: { color: colors.muted, fontSize: 13 },
});
