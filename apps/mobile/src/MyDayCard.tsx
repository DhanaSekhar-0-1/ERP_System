import { colors, DeviceLocation, StaffAttendanceRecord } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { Button, Card, errorText } from './ui';

/** Reads where the phone is now, asking for permission the first time. */
async function currentLocation(): Promise<DeviceLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Allow location for this app so it can check that you are at school.');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? 9999,
  };
}

const STATUS: Record<StaffAttendanceRecord['status'], { label: string; color: string; background: string }> = {
  PRESENT: { label: 'Present', color: colors.success, background: colors.successSoft },
  LATE: { label: 'Late', color: colors.warning, background: colors.warningSoft },
  ABSENT: { label: 'Absent', color: colors.danger, background: colors.dangerSoft },
  ON_LEAVE: { label: 'On leave', color: colors.info, background: colors.infoSoft },
};

function hours(minutes: number | null) {
  if (minutes === null) return '';
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min at school`;
}

/**
 * The teacher's own check-in and check-out for today. Works only at school: the phone's
 * location is checked against the school's radius on the server.
 */
export function MyDayCard() {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const today = useQuery({ queryKey: ['my-attendance'], queryFn: api.myAttendanceToday });
  const act = useMutation({
    mutationFn: async (kind: 'in' | 'out') => {
      const location = await currentLocation();
      return kind === 'in' ? api.checkIn(location) : api.checkOut(location);
    },
    onMutate: () => setError(''),
    onError: (failure) => setError(errorText(failure)),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-attendance'] }),
  });

  if (today.isLoading) return null;
  if (today.isError) {
    return (
      <Card>
        <Text style={styles.error}>{errorText(today.error)}</Text>
      </Card>
    );
  }
  const data = today.data;
  if (!data) return null;
  const record = data.record;
  const status = record ? STATUS[record.status] : data.onLeave ? STATUS.ON_LEAVE : null;

  return (
    <Card>
      <View style={styles.top}>
        <Text style={styles.title}>My attendance today</Text>
        {status && (
          <View style={[styles.pill, { backgroundColor: status.background }]}>
            <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
          </View>
        )}
      </View>

      {data.onLeave && !record && <Text style={styles.meta}>You are on approved leave today.</Text>}
      {!data.locationReady && (
        <Text style={styles.meta}>The school location is not set yet. Ask the School Admin to set it in Settings.</Text>
      )}
      {record?.checkInTime && (
        <Text style={styles.meta}>
          In at {record.checkInTime}
          {record.checkOutTime ? ` · Out at ${record.checkOutTime} · ${hours(record.minutesAtSchool)}` : ''}
        </Text>
      )}
      {record?.corrected && <Text style={styles.meta}>Updated by the school office: {record.correctionReason}</Text>}
      {!record && !data.onLeave && data.locationReady && (
        <Text style={styles.meta}>Check in when you reach school. After {data.lateAfter} it counts as late.</Text>
      )}

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {data.locationReady && !data.onLeave && !record && (
        <Button label="Check in" icon="log-in-outline" busy={act.isPending} onPress={() => act.mutate('in')} style={styles.button} />
      )}
      {data.locationReady && record?.checkInTime && !record.checkOutTime && (
        <Button
          label="Check out"
          icon="log-out-outline"
          variant="soft"
          busy={act.isPending}
          onPress={() => act.mutate('out')}
          style={styles.button}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  pillText: { fontSize: 11, fontWeight: '800' },
  meta: { color: colors.muted, marginTop: 6, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontWeight: '600', marginTop: 10 },
  button: { marginTop: 14 },
});
