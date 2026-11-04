import { Ionicons } from '@expo/vector-icons';
import { colors, fullName, isoDate } from '@erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { listenForCards, NfcState, nfcState } from '../src/nfc';
import { Button, errorText } from '../src/ui';

interface Scan {
  key: number;
  title: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger';
}

const TONES = {
  success: { color: colors.success, soft: colors.successSoft, icon: 'checkmark-circle' },
  warning: { color: colors.warning, soft: colors.warningSoft, icon: 'information-circle' },
  danger: { color: colors.danger, soft: colors.dangerSoft, icon: 'close-circle' },
} as const;

/** A card held against the phone fires repeatedly; ignore repeats within this window. */
const REPEAT_MS = 3000;

function feedback(type: Haptics.NotificationFeedbackType) {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(type);
}

export default function ScanScreen() {
  const { sectionId, title } = useLocalSearchParams<{ sectionId: string; title: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const date = isoDate();
  const [state, setState] = useState<NfcState | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [typed, setTyped] = useState('');
  const lastCard = useRef({ id: '', at: 0 });
  const pulse = useRef(new Animated.Value(0)).current;

  const roster = useQuery({
    queryKey: ['roster', sectionId, date],
    queryFn: () => api.sectionAttendance(sectionId, date),
  });
  const marked = roster.data?.filter((row) => row.attendance).length ?? 0;
  const total = roster.data?.length ?? 0;

  const handleCard = useCallback(
    async (cardId: string) => {
      const now = Date.now();
      if (lastCard.current.id === cardId && now - lastCard.current.at < REPEAT_MS) return;
      lastCard.current = { id: cardId, at: now };
      let scan: Omit<Scan, 'key'>;
      try {
        const { result, record } = await api.nfcScan(cardId, date, sectionId);
        const name = fullName(record.enrollment.student);
        if (result === 'marked') {
          scan = { title: name, detail: 'Marked present', tone: 'success' };
          feedback(Haptics.NotificationFeedbackType.Success);
        } else {
          scan = { title: name, detail: 'Already marked today', tone: 'warning' };
          feedback(Haptics.NotificationFeedbackType.Warning);
        }
        await client.invalidateQueries({ queryKey: ['roster', sectionId, date] });
      } catch (error) {
        scan = { title: 'Card not accepted', detail: errorText(error), tone: 'danger' };
        feedback(Haptics.NotificationFeedbackType.Error);
      }
      setScans((previous) => [{ ...scan, key: now }, ...previous].slice(0, 30));
    },
    [client, date, sectionId],
  );

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const next = await nfcState();
      if (cancelled) return;
      setState(next);
      if (next !== 'ready') return;
      const stopListening = await listenForCards((id) => void handleCard(id));
      if (cancelled) stopListening();
      else stop = stopListening;
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [handleCard]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const prompt =
    state === 'ready'
      ? 'Hold a student card to the back of the phone'
      : state === 'disabled'
        ? 'NFC is turned off. Enable it in your phone settings.'
        : state === 'unsupported'
          ? 'NFC is not available here. Type the card ID below.'
          : 'Starting NFC…';

  return (
    <View style={styles.page}>
      <LinearGradient
        colors={[colors.ink, colors.primaryDark, colors.primary]}
        style={[styles.hero, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.heroTop}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.count} accessibilityLabel={`${marked} of ${total} marked`}>
            {marked}/{total}
          </Text>
        </View>
        <View style={styles.pulseArea}>
          <Animated.View
            style={[
              styles.ring,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.5] }) }],
              },
            ]}
          />
          <View style={styles.core}>
            <Ionicons name="radio-outline" size={48} color="#fff" />
          </View>
        </View>
        <Text style={styles.prompt}>{prompt}</Text>
      </LinearGradient>

      {state !== null && state !== 'ready' && (
        <View style={styles.typeRow}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Card ID"
            accessibilityLabel="Card ID"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Button
            label="Submit"
            disabled={!typed.trim()}
            onPress={() => {
              void handleCard(typed.trim());
              setTyped('');
            }}
          />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list}>
        {scans.length === 0 && <Text style={styles.empty}>Scanned students will appear here.</Text>}
        {scans.map((scan) => {
          const tone = TONES[scan.tone];
          return (
            <View key={scan.key} style={[styles.scan, { backgroundColor: tone.soft }]}>
              <Ionicons name={tone.icon} size={26} color={tone.color} />
              <View style={styles.scanBody}>
                <Text style={styles.scanTitle}>{scan.title}</Text>
                <Text style={[styles.scanDetail, { color: tone.color }]}>{scan.detail}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  hero: { paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800' },
  count: { color: '#FCD34D', fontSize: 20, fontWeight: '800' },
  pulseArea: { height: 170, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: '#fff' },
  core: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: { color: '#E0E7FF', textAlign: 'center', fontSize: 15, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16 },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.ink,
  },
  list: { padding: 16, gap: 10 },
  empty: { textAlign: 'center', color: colors.muted, paddingVertical: 20 },
  scan: { flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 16, padding: 14 },
  scanBody: { flex: 1 },
  scanTitle: { fontWeight: '800', color: colors.ink, fontSize: 15 },
  scanDetail: { fontWeight: '600', marginTop: 1, fontSize: 13 },
});
