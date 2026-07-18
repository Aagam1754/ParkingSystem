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
import { MeAPI } from '../api/endpoints';
import { colors, spacing } from '../theme';

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function CurrentSlotScreen() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const data = await MeAPI.currentSession();
      setSession(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
      }
    >
      <Text style={styles.eyebrow}>Live allotment</Text>
      <Text style={styles.title}>Your current slot</Text>
      <Text style={styles.sub}>Pull to refresh after gate check-in</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!session ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Not parked</Text>
          <Text style={styles.emptyBody}>
            When security checks in one of your plates, the basement and bay appear here.
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={() => load(true)}>
            <Text style={styles.secondaryBtnText}>Refresh</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.slotCode}>{session.slot_code || '—'}</Text>
          <Text style={styles.base}>
            {session.base_name} ({session.base_code})
          </Text>

          <View style={styles.row}>
            <Text style={styles.label}>Plate</Text>
            <Text style={styles.value}>{session.plate_raw || session.plate_normalized}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Session</Text>
            <Text style={styles.value}>{session.session_type}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Company</Text>
            <Text style={styles.value}>{session.company_name || 'General'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Vehicle</Text>
            <Text style={styles.value}>{session.vehicle_type}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Started</Text>
            <Text style={styles.value}>{formatWhen(session.started_at)}</Text>
          </View>
          {session.allotment_note ? (
            <Text style={styles.note}>{session.allotment_note}</Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  content: { padding: spacing.lg, paddingBottom: 40 },
  center: {
    flex: 1,
    backgroundColor: colors.bg0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: colors.accent2,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  sub: { color: colors.muted, marginBottom: spacing.lg },
  error: { color: colors.danger, marginBottom: spacing.md },
  empty: {
    backgroundColor: colors.bg1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  emptyBody: { color: colors.muted, lineHeight: 22 },
  secondaryBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryBtnText: { color: colors.accent, fontWeight: '700' },
  card: {
    backgroundColor: colors.bg1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: 10,
  },
  slotCode: {
    color: colors.accent,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1,
  },
  base: { color: colors.muted, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  label: { color: colors.muted },
  value: { color: colors.ink, fontWeight: '600' },
  note: {
    marginTop: spacing.sm,
    color: colors.warn,
    fontSize: 13,
  },
});
