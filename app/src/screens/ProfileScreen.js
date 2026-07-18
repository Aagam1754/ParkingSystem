import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { API_URL } from '../config';
import { colors, spacing } from '../theme';

export default function ProfileScreen() {
  const { profile, logout, refreshProfile } = useAuth();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      await refreshProfile();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [refreshProfile]);

  useFocusEffect(
    useCallback(() => {
      refreshProfile().catch((err) => setError(err.message));
    }, [refreshProfile])
  );

  if (!profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const accent = profile.companyColor || colors.accent;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.accent} />
      }
    >
      <View style={[styles.avatar, { backgroundColor: accent }]}>
        <Text style={styles.avatarText}>
          {(profile.fullName || '?')
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </Text>
      </View>
      <Text style={styles.name}>{profile.fullName}</Text>
      <Text style={styles.sub}>{profile.email}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Row label="Building" value={profile.buildingName || 'Eastface'} />
        <Row label="Company" value={profile.companyName || '—'} />
        <Row label="Company code" value={profile.companyCode || '—'} />
        <Row label="Floor" value={profile.companyFloor || '—'} />
        <Row label="Employee" value={profile.employeeCode || '—'} />
        <Row label="Role" value={profile.role} />
        <Row label="API" value={API_URL} last />
      </View>

      <Text style={styles.help}>
        Parking is allotted at the gate (admin Check-in / Manual Desk). This app shows your slot,
        manages in-service / temp plates, and history — same MySQL + allotment rules.
      </Text>

      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
    alignItems: 'stretch',
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { color: colors.bg0, fontWeight: '900', fontSize: 22 },
  name: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  sub: { color: colors.muted, textAlign: 'center', marginBottom: spacing.lg },
  error: { color: colors.danger, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.bg1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  label: { color: colors.muted },
  value: { color: colors.ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  help: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.lg,
  },
  logout: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: colors.danger, fontWeight: '800' },
});
