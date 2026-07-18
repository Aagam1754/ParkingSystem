import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MeAPI } from '../api/endpoints';
import { colors, spacing } from '../theme';
import { formatWhen, sessionTypeLabel } from '../utils/format';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

export default function HistoryScreen() {
  const [sessions, setSessions] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const opts = { limit: 80 };
        if (filter !== 'all') opts.status = filter;
        setSessions(await MeAPI.sessions(opts));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    load();
  }, [load]);

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
      <Text style={styles.sub}>Your parking sessions from the same allotment engine as admin</Text>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipOn]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

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
            {s.slot_code || 'No slot'} · {s.base_name} · {sessionTypeLabel(s.session_type)}
          </Text>
          {s.company_name ? <Text style={styles.meta}>{s.company_name}</Text> : null}
          <Text style={styles.meta}>In {formatWhen(s.started_at)}</Text>
          {s.exited_at ? <Text style={styles.meta}>Out {formatWhen(s.exited_at)}</Text> : null}
          {s.allotment_note ? <Text style={styles.note}>{s.allotment_note}</Text> : null}
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
  filters: { flexDirection: 'row', gap: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.muted, fontWeight: '700' },
  filterTextOn: { color: colors.bg0 },
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
  note: { color: colors.warn, fontSize: 12, marginTop: 4 },
});
