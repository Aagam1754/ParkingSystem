import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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

export default function HistoryScreen() {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setSessions(await MeAPI.sessions(80));
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
      <Text style={styles.title}>History</Text>
      <Text style={styles.sub}>Your past and open parking sessions</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {sessions.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.plate}>{s.plate_raw || s.plate_normalized}</Text>
            <Text style={[styles.status, s.is_open ? styles.open : styles.closed]}>
              {s.is_open ? 'OPEN' : s.status}
            </Text>
          </View>
          <Text style={styles.meta}>
            {s.slot_code || 'No slot'} · {s.base_name} · {s.session_type}
          </Text>
          <Text style={styles.meta}>In {formatWhen(s.started_at)}</Text>
          {s.exited_at ? <Text style={styles.meta}>Out {formatWhen(s.exited_at)}</Text> : null}
        </View>
      ))}

      {!sessions.length ? <Text style={styles.muted}>No sessions yet.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  content: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  center: {
    flex: 1,
    backgroundColor: colors.bg0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.ink, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.muted, marginBottom: 4 },
  error: { color: colors.danger },
  muted: { color: colors.muted },
  card: {
    backgroundColor: colors.bg1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plate: { color: colors.ink, fontWeight: '800', fontSize: 17 },
  status: { fontSize: 11, fontWeight: '800' },
  open: { color: colors.accent2 },
  closed: { color: colors.muted },
  meta: { color: colors.muted, fontSize: 13 },
});
