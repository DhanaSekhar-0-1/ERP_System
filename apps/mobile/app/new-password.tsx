import { Ionicons } from '@expo/vector-icons';
import { colors, newPasswordProblem } from '@erp/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, PasswordInput, errorText } from '../src/ui';

/**
 * Shown instead of every other screen while the account is still on the first password the
 * school gave out (students, families and teachers). The server refuses other requests until
 * the password is changed.
 */
export default function NewPassword() {
  const { user, signOut, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return <Redirect href="/login" />;
  if (!user.mustChangePassword) return <Redirect href="/" />;

  const submit = async () => {
    const problem = newPasswordProblem(next, confirm, current);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.changePassword(current, next);
      await refresh();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={[colors.ink, colors.primaryDark, colors.primary]} style={styles.page}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.page}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logo}>
            <Ionicons name="key" size={32} color="#fff" />
          </View>
          <Text style={styles.title}>Choose your own password</Text>
          <Text style={styles.subtitle}>
            Welcome{user.displayName ? `, ${user.displayName}` : ''}. You signed in with the first password from the
            school. Choose a new one that only you know before you continue.
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>First password (from the school)</Text>
            <PasswordInput
              value={current}
              onChangeText={setCurrent}
              autoComplete="password"
              accessibilityLabel="First password from the school"
              style={styles.input}
            />
            <Text style={styles.label}>New password</Text>
            <PasswordInput
              value={next}
              onChangeText={setNext}
              autoComplete="password-new"
              accessibilityLabel="New password"
              style={styles.input}
            />
            <Text style={styles.hint}>At least 8 characters, with a letter and a number.</Text>
            <Text style={styles.label}>New password again</Text>
            <PasswordInput
              value={confirm}
              onChangeText={setConfirm}
              autoComplete="password-new"
              accessibilityLabel="New password again"
              onSubmitEditing={() => void submit()}
              style={styles.input}
            />
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Button label="Save and continue" busy={busy} onPress={() => void submit()} />
            <Button label="Sign out" variant="soft" onPress={() => void signOut()} style={styles.signOut} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 24, letterSpacing: -0.4 },
  subtitle: { color: '#C7D2FE', marginTop: 8, fontSize: 15, lineHeight: 21 },
  form: { backgroundColor: '#fff', borderRadius: 24, padding: 20, marginTop: 28 },
  label: { fontWeight: '700', color: colors.ink, fontSize: 13, marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 12, marginTop: -8, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 14,
  },
  error: { color: colors.danger, fontWeight: '600', marginBottom: 10 },
  signOut: { marginTop: 10 },
});
