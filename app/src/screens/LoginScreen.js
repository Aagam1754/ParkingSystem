import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { API_URL } from '../config';
import { colors, spacing } from '../theme';

const DEMO_ACCOUNTS = [
  { email: 'priya@yorkie.local', label: 'York IE · Priya' },
  { email: 'aisha@nexus.local', label: 'Nexus · Aisha' },
  { email: 'meera@orbit.local', label: 'Orbit · Meera' },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('priya@yorkie.local');
  const [password, setPassword] = useState('Admin@123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.heroGlow} />
      <View style={styles.card}>
        <View style={styles.mark}>
          <Text style={styles.markText}>PL</Text>
        </View>
        <Text style={styles.brand}>ParkLane</Text>
        <Text style={styles.sub}>Eastface member companion</Text>
        <Text style={styles.apiHint}>API · {API_URL}</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          placeholder="you@company.local"
          placeholderTextColor={colors.muted}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.muted}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, busy && styles.btnDisabled]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg0} />
          ) : (
            <Text style={styles.btnText}>Sign in</Text>
          )}
        </Pressable>

        <Text style={styles.demoTitle}>Quick demo accounts (password Admin@123)</Text>
        <View style={styles.demoRow}>
          {DEMO_ACCOUNTS.map((a) => (
            <Pressable
              key={a.email}
              style={styles.demoChip}
              onPress={() => {
                setEmail(a.email);
                setPassword('Admin@123');
              }}
            >
              <Text style={styles.demoChipText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg0,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  heroGlow: {
    position: 'absolute',
    top: -80,
    left: -40,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(61, 255, 168, 0.12)',
  },
  card: {
    backgroundColor: colors.bg1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  markText: {
    color: colors.bg0,
    fontWeight: '800',
    fontSize: 18,
  },
  brand: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  sub: {
    color: colors.muted,
  },
  apiHint: {
    color: colors.muted,
    fontSize: 11,
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
  },
  btn: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  btnText: {
    color: colors.bg0,
    fontWeight: '800',
    fontSize: 16,
  },
  error: {
    color: colors.danger,
    marginTop: 4,
  },
  demoTitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.md,
  },
  demoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bg2,
  },
  demoChipText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
});
