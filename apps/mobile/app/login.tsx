import { Ionicons } from '@expo/vector-icons';
import { colors } from '@erp/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getServer, saveServer } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, errorText } from '../src/ui';

export default function Login() {
  const { user, signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(getServer());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href="/" />;

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError('Enter your ID and password');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveServer(server);
      await signIn(identifier.trim(), password);
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
            <Ionicons name="school" size={36} color="#fff" />
          </View>
          <Text style={styles.title}>Every student,{'\n'}accounted for.</Text>
          <Text style={styles.subtitle}>Sign in with your school account.</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email, student ID or staff ID</Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              accessibilityLabel="Email, student ID or staff ID"
              style={styles.input}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              accessibilityLabel="Password"
              onSubmitEditing={() => void submit()}
              style={styles.input}
            />
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Button label="Sign in" busy={busy} onPress={() => void submit()} style={styles.submit} />

            <Pressable onPress={() => setShowServer(!showServer)} accessibilityRole="button" style={styles.serverToggle}>
              <Ionicons name="settings-outline" size={14} color={colors.muted} />
              <Text style={styles.serverToggleText}>Server settings</Text>
            </Pressable>
            {showServer && (
              <TextInput
                value={server}
                onChangeText={setServer}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="Server address"
                style={styles.input}
              />
            )}
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
  title: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 24, letterSpacing: -0.6 },
  subtitle: { color: '#C7D2FE', marginTop: 8, fontSize: 15 },
  form: { backgroundColor: '#fff', borderRadius: 24, padding: 20, marginTop: 28 },
  label: { fontWeight: '700', color: colors.ink, fontSize: 13, marginBottom: 6 },
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
  submit: { marginTop: 4 },
  serverToggle: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingTop: 14, paddingBottom: 8 },
  serverToggleText: { color: colors.muted, fontSize: 12 },
});
