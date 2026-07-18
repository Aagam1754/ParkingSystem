import { Alert, Platform, ToastAndroid } from 'react-native';

const listeners = new Set();

/** In-app alerts only — Expo Go does not support expo-notifications push. */
export function onParkAlert(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitAlert(payload) {
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  });
}

function showNativeFallback(title, body) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(`${title}: ${body}`, ToastAndroid.LONG);
  } else {
    Alert.alert(title, body);
  }
}

export async function ensureNotificationPermission() {
  return true;
}

export async function notifyParkedCorrectly(session) {
  if (!session) return false;

  const slot = session.slot_code || session.slotCode || 'your bay';
  const basement = session.base_code || session.basementCode || '';
  const plate = session.plate_raw || session.plate || '';
  const pool = session.session_type || session.sessionType || '';
  const title = 'Parked correctly';
  const body = [
    `Allotted ${slot}${basement ? ` on ${basement}` : ''}`,
    plate ? `· ${plate}` : null,
    pool ? `· ${pool} pool` : null,
    '— gate check-in confirmed.',
  ]
    .filter(Boolean)
    .join(' ');

  emitAlert({ type: 'parked', title, body, sessionId: session.id, slot });
  showNativeFallback(title, body);
  return true;
}

export async function notifyGuidedBayMatch(session, guidedSlotCode) {
  if (!session) return false;
  const slot = session.slot_code || session.slotCode;
  const title = 'You reached the guided bay';
  const body = `Parked at ${slot} — matches assistant guidance${
    guidedSlotCode && slot !== guidedSlotCode ? ` (gate allotted ${slot})` : ''
  }.`;
  emitAlert({ type: 'guided-match', title, body, sessionId: session.id, slot });
  showNativeFallback(title, body);
  return true;
}
