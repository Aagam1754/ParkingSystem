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
import { useAuth } from '../auth/AuthContext';
import { colors, spacing } from '../theme';
import { formatWhen, sessionTypeHint, sessionTypeLabel } from '../utils/format';

export default function CurrentSlotScreen() {
  const { profile } = useAuth();
  const [session, setSession] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [current, ov] = await Promise.all([MeAPI.currentSession(), MeAPI.overview()]);
      setSession(current);
      setOverview(ov);
      setLastSync(new Date());
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
      // Poll like admin display board — avoids fragile socket.io Metro bundling on Expo Go
      const poll = setInterval(() => load(true).catch(() => {}), 4000);
      return () => clearInterval(poll);
    }, [load])
  );

  const accent = session?.company_color || profile?.companyColor || colors.accent;

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
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Live allotment</Text>
          <Text style={styles.title}>Your current slot</Text>
        </View>
        <View style={styles.livePill}>
          <Text style={styles.liveText}>AUTO</Text>
        </View>
      </View>
      <Text style={styles.sub}>
        Gate check-in (admin webcam / manual desk) updates this screen every few seconds — same
        allotment engine as the control room.
      </Text>
      {lastSync ? (
        <Text style={styles.sync}>Last sync · {lastSync.toLocaleTimeString()}</Text>
      ) : null}

      {overview ? (
        <View style={styles.stats}>
          <Stat label="Vehicles" value={overview.vehicles?.total ?? 0} />
          <Stat label="In service" value={overview.vehicles?.inService ?? 0} />
          <Stat label="Parked" value={overview.openSessions ?? 0} />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!session ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Not parked</Text>
          <Text style={styles.emptyBody}>
            When security checks in one of your ACTIVE plates, the basement bay appears here with
            company-pool or general-overflow details (FCFS).
          </Text>
          <Text style={styles.emptyHint}>
            Tip: plates marked IN_SERVICE are rejected at the gate — use a claimed temp plate instead.
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={() => load(true)}>
            <Text style={styles.secondaryBtnText}>Refresh now</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.card, { borderColor: accent }]}>
          <Text style={styles.welcome}>
            Welcome{profile?.fullName ? `, ${profile.fullName}` : ''}
          </Text>
          <Text style={[styles.slotCode, { color: accent }]}>{session.slot_code || '—'}</Text>
          <Text style={styles.base}>
            {session.base_name} ({session.base_code})
          </Text>

          <View style={styles.row}>
            <Text style={styles.label}>Plate</Text>
            <Text style={styles.value}>{session.plate_raw || session.plate_normalized}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Pool</Text>
            <Text style={styles.value}>{sessionTypeLabel(session.session_type)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Company</Text>
            <Text style={styles.value}>{session.company_name || 'General'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Vehicle</Text>
            <Text style={styles.value}>
              {session.vehicle_type}
              {session.make ? ` · ${session.make}` : ''}
              {session.model ? ` ${session.model}` : ''}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Started</Text>
            <Text style={styles.value}>{formatWhen(session.started_at)}</Text>
          </View>

          <Text style={styles.hint}>{sessionTypeHint(session.session_type)}</Text>
          {session.allotment_note ? <Text style={styles.note}>{session.allotment_note}</Text> : null}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  sub: { color: colors.muted, marginBottom: 4, marginTop: 6 },
  sync: { color: colors.muted, fontSize: 12, marginBottom: spacing.md },
  livePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(61, 255, 168, 0.2)',
  },
  liveText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 10, marginBottom: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.bg1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  statValue: { color: colors.accent, fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
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
  emptyHint: { color: colors.warn, fontSize: 13, lineHeight: 20 },
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
    borderWidth: 2,
    padding: spacing.lg,
    gap: 10,
  },
  welcome: { color: colors.muted, fontWeight: '600' },
  slotCode: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  base: { color: colors.muted, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  label: { color: colors.muted },
  value: { color: colors.ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  hint: { color: colors.muted, fontSize: 13, marginTop: 8, lineHeight: 20 },
  note: {
    marginTop: 4,
    color: colors.warn,
    fontSize: 13,
  },
});
