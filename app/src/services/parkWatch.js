import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeAPI } from '../api/endpoints';
import { notifyGuidedBayMatch, notifyParkedCorrectly } from './parkAlerts';

const LAST_SESSION_KEY = 'parklane_last_notified_session';
const GUIDED_SLOT_KEY = 'parklane_guided_slot';

export async function setGuidedSlot(slotCode) {
  if (slotCode) await AsyncStorage.setItem(GUIDED_SLOT_KEY, String(slotCode));
  else await AsyncStorage.removeItem(GUIDED_SLOT_KEY);
}

export async function getGuidedSlot() {
  return AsyncStorage.getItem(GUIDED_SLOT_KEY);
}

/**
 * Poll open session; notify once when gate allotment confirms a new park.
 */
export function startParkWatch({ intervalMs = 5000 } = {}) {
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const session = await MeAPI.currentSession();
      const lastId = await AsyncStorage.getItem(LAST_SESSION_KEY);
      if (session?.id) {
        const id = String(session.id);
        if (id !== lastId) {
          await AsyncStorage.setItem(LAST_SESSION_KEY, id);
          const guided = await getGuidedSlot();
          const slot = session.slot_code || session.slotCode;
          if (guided && slot && String(guided) === String(slot)) {
            await notifyGuidedBayMatch(session, guided);
          } else {
            await notifyParkedCorrectly(session);
          }
          if (guided) await setGuidedSlot(null);
        }
      } else if (lastId) {
        // Checked out — allow next park to notify again
        await AsyncStorage.removeItem(LAST_SESSION_KEY);
      }
    } catch {
      /* offline / API blip */
    }
  }

  tick();
  timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
