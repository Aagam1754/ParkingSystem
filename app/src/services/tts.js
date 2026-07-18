import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { API_URL } from '../config';
import { getToken, setToken } from '../api/client';

let player = null;
let audioModeReady = false;

async function ensureAudioMode() {
  if (audioModeReady) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'duckOthers',
  });
  audioModeReady = true;
}

export function stopSpeaking() {
  try {
    if (player) {
      player.pause();
      player.remove();
    }
  } catch {
    /* ignore */
  }
  player = null;
}

/**
 * Speak via backend ElevenLabs.
 * When `navigation` is ok, TTS uses spokenScript (free bay + directions only).
 */
export async function speakAssistant({ text, navigation = null } = {}) {
  const token = await getToken();
  if (!token) throw new Error('Login required for voice');

  await ensureAudioMode();
  stopSpeaking();

  const body = navigation?.ok
    ? { navigation, slotOnly: true }
    : { text: String(text || ''), slotOnly: false };

  let res;
  try {
    res = await fetch(`${API_URL}/api/assistant/speak`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach API at ${API_URL} for speech`);
  }

  if (!res.ok) {
    if (res.status === 401) await setToken(null);
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Speech failed (${res.status})`);
  }

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const file = new File(Paths.cache, `parklane-tts-${Date.now()}.mp3`);
  file.create();
  file.write(bytes);

  player = createAudioPlayer(file.uri);
  player.play();

  return new Promise((resolve) => {
    const started = Date.now();
    const check = setInterval(() => {
      if (!player) {
        clearInterval(check);
        resolve();
        return;
      }
      try {
        const done =
          player.duration > 0 &&
          !player.playing &&
          player.currentTime >= Math.max(0, player.duration - 0.2);
        if (done || Date.now() - started > 120000) {
          clearInterval(check);
          stopSpeaking();
          resolve();
        }
      } catch {
        clearInterval(check);
        resolve();
      }
    }, 350);
  });
}
