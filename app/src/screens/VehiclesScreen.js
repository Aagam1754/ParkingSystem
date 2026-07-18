import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MeAPI } from '../api/endpoints';
import { colors, spacing } from '../theme';

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [claimOpen, setClaimOpen] = useState(false);
  const [replacesId, setReplacesId] = useState(null);
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState('CAR');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [info, setInfo] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setVehicles(await MeAPI.vehicles());
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

  async function toggleStatus(vehicle) {
    const next = vehicle.status === 'IN_SERVICE' ? 'ACTIVE' : 'IN_SERVICE';
    setBusyId(vehicle.id);
    setError('');
    setInfo('');
    try {
      await MeAPI.setVehicleStatus(vehicle.id, next);
      if (next === 'IN_SERVICE') {
        setInfo(
          `${vehicle.plate_normalized} is IN_SERVICE — gate will reject this plate. Claim a temp plate for company-pool entry.`
        );
      }
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function openClaim(vehicle) {
    setReplacesId(vehicle.id);
    setPlate('');
    setVehicleType(vehicle.vehicle_type || 'CAR');
    setMake('');
    setModel('');
    setClaimError('');
    setClaimOpen(true);
  }

  async function submitClaim() {
    setClaimBusy(true);
    setClaimError('');
    try {
      const created = await MeAPI.tempClaim({
        plate: plate.trim(),
        vehicleType,
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        replacesVehicleId: replacesId,
      });
      setClaimOpen(false);
      setInfo(created.hint || `Temp plate ${created.plate_normalized} registered for company pool.`);
      await load(true);
    } catch (err) {
      setClaimError(err.message);
    } finally {
      setClaimBusy(false);
    }
  }

  async function retireTemp(vehicle) {
    setBusyId(vehicle.id);
    setError('');
    try {
      await MeAPI.retireTemp(vehicle.id);
      setInfo(`Retired temp plate ${vehicle.plate_normalized}`);
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={styles.title}>My vehicles</Text>
        <Text style={styles.sub}>
          Same registry the gate uses: ACTIVE company plates → company FCFS pool. IN_SERVICE → use a
          claimed temp plate (still company pool).
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        {vehicles.map((v) => {
          const isTemp = v.auth_type === 'TEMP_SERVICE';
          return (
            <View key={v.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.plate}>{v.plate_normalized || v.plate_raw}</Text>
                <View
                  style={[
                    styles.badge,
                    v.status === 'IN_SERVICE' && styles.badgeWarn,
                    v.status === 'ACTIVE' && styles.badgeOk,
                  ]}
                >
                  <Text style={styles.badgeText}>{v.status}</Text>
                </View>
              </View>

              <Text style={styles.meta}>
                {v.vehicle_type}
                {v.make ? ` · ${v.make}` : ''}
                {v.model ? ` ${v.model}` : ''}
                {v.company_name ? ` · ${v.company_name}` : ''}
              </Text>
              <Text style={styles.meta}>Auth · {v.auth_type || 'OWNED'}</Text>

              {v.active_session_id ? (
                <Text style={styles.parked}>
                  Parked · {v.active_slot_code || 'slot'} ({v.active_base_code || '—'}) ·{' '}
                  {v.active_session_type || 'OPEN'}
                </Text>
              ) : null}

              {v.status === 'IN_SERVICE' ? (
                <Text style={styles.warnLine}>
                  Gate will reject this plate until you mark it ACTIVE again.
                </Text>
              ) : null}

              <View style={styles.actions}>
                {!isTemp ? (
                  <Pressable
                    style={styles.actionBtn}
                    onPress={() => toggleStatus(v)}
                    disabled={busyId === v.id || v.status === 'BLOCKED'}
                  >
                    {busyId === v.id ? (
                      <ActivityIndicator color={colors.bg0} />
                    ) : (
                      <Text style={styles.actionBtnText}>
                        {v.status === 'IN_SERVICE' ? 'Mark ACTIVE' : 'Mark IN_SERVICE'}
                      </Text>
                    )}
                  </Pressable>
                ) : null}

                {v.status === 'IN_SERVICE' && !isTemp ? (
                  <Pressable style={styles.outlineBtn} onPress={() => openClaim(v)}>
                    <Text style={styles.outlineBtnText}>Claim temp plate</Text>
                  </Pressable>
                ) : null}

                {isTemp ? (
                  <Pressable
                    style={styles.outlineBtn}
                    onPress={() => retireTemp(v)}
                    disabled={busyId === v.id}
                  >
                    <Text style={styles.outlineBtnText}>Retire temp plate</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}

        {!vehicles.length ? (
          <Text style={styles.muted}>No vehicles linked to your account.</Text>
        ) : null}
      </ScrollView>

      <Modal visible={claimOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Claim temp plate</Text>
            <Text style={styles.sub}>
              Registers an ACTIVE company vehicle under you (TEMP_SERVICE). Gate allotment uses the
              same FCFS company pool as your normal plate.
            </Text>

            <Text style={styles.label}>Plate</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="characters"
              value={plate}
              onChangeText={setPlate}
              placeholder="GJ01TEMP01"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Type</Text>
            <View style={styles.typeRow}>
              {['CAR', 'BIKE'].map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeChip, vehicleType === t && styles.typeChipOn]}
                  onPress={() => setVehicleType(t)}
                >
                  <Text style={[styles.typeChipText, vehicleType === t && styles.typeChipTextOn]}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Make (optional)</Text>
            <TextInput
              style={styles.input}
              value={make}
              onChangeText={setMake}
              placeholderTextColor={colors.muted}
              placeholder="Make"
            />
            <Text style={styles.label}>Model (optional)</Text>
            <TextInput
              style={styles.input}
              value={model}
              onChangeText={setModel}
              placeholderTextColor={colors.muted}
              placeholder="Model"
            />

            {claimError ? <Text style={styles.error}>{claimError}</Text> : null}

            <View style={styles.actions}>
              <Pressable style={styles.outlineBtn} onPress={() => setClaimOpen(false)}>
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={submitClaim} disabled={claimBusy}>
                {claimBusy ? (
                  <ActivityIndicator color={colors.bg0} />
                ) : (
                  <Text style={styles.actionBtnText}>Register</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  content: { padding: spacing.lg, paddingBottom: 48, gap: spacing.md },
  center: {
    flex: 1,
    backgroundColor: colors.bg0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.ink, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.muted, marginBottom: 4, lineHeight: 20 },
  error: { color: colors.danger },
  info: { color: colors.accent2, lineHeight: 20 },
  muted: { color: colors.muted },
  card: {
    backgroundColor: colors.bg1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  plate: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  badge: {
    backgroundColor: colors.bg3,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeOk: { backgroundColor: 'rgba(61, 255, 168, 0.2)' },
  badgeWarn: { backgroundColor: 'rgba(255, 176, 32, 0.25)' },
  badgeText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  meta: { color: colors.muted },
  parked: { color: colors.accent2, fontWeight: '600' },
  warnLine: { color: colors.warn, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: 'center',
  },
  actionBtnText: { color: colors.bg0, fontWeight: '800' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: colors.accent2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  outlineBtnText: { color: colors.accent2, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.bg1,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: spacing.lg,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  modalTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 13, marginTop: 6 },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
  },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typeChipOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  typeChipText: { color: colors.muted, fontWeight: '700' },
  typeChipTextOn: { color: colors.bg0 },
});
