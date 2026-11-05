import { Ionicons } from '@expo/vector-icons';
import { colors, initials, longToday } from '@erp/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from './auth';

export function HeroHeader({ title, subtitle, children }: { title?: string; subtitle?: string; children?: ReactNode }) {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[colors.ink, colors.primaryDark, colors.primary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, { paddingTop: insets.top + 16 }]}
    >
      <View style={styles.heroRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(user?.displayName ?? '')}</Text>
        </View>
        <View style={styles.heroName}>
          <Text style={styles.heroSchool} numberOfLines={1}>
            {user?.school?.name}
          </Text>
          <Text style={styles.heroDate}>{longToday()}</Text>
        </View>
        <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={10}>
          <Ionicons name="log-out-outline" size={24} color="#fff" />
        </Pressable>
      </View>
      {title && <Text style={styles.heroTitle}>{title}</Text>}
      {subtitle && <Text style={styles.heroSubtitle}>{subtitle}</Text>}
      {children}
    </LinearGradient>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress(): void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'soft';
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const foreground = variant === 'primary' ? '#fff' : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: variant === 'primary' ? colors.primary : colors.primarySoft },
        (pressed || busy || disabled) && styles.dimmed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={foreground} />}
          <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export const tabIcon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} color={String(color)} size={size} />;

export function Empty({ text, tone }: { text: string; tone?: 'error' }) {
  return <Text style={[styles.empty, tone === 'error' && { color: colors.danger }]}>{text}</Text>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800' },
  heroName: { flex: 1 },
  heroSchool: { color: '#fff', fontWeight: '700', fontSize: 14 },
  heroDate: { color: '#C7D2FE', fontSize: 12, marginTop: 1 },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 20, letterSpacing: -0.4 },
  heroSubtitle: { color: '#C7D2FE', fontSize: 14, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    minHeight: 46,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonText: { fontWeight: '700', fontSize: 14 },
  dimmed: { opacity: 0.6 },
  empty: { textAlign: 'center', color: colors.muted, paddingVertical: 28, fontSize: 14 },
});
