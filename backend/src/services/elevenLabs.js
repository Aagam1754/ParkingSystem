/**
 * ElevenLabs Text-to-Speech for ParkLane Assistant.
 * Requires ELEVENLABS_API_KEY in backend/.env
 */

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — clear, widely available
const DEFAULT_MODEL = 'eleven_flash_v2_5'; // low latency for chat

export function isElevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

export function getElevenLabsConfig() {
  return {
    configured: isElevenLabsConfigured(),
    voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
    modelId: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
  };
}

/** Strip markdown / UI noise so TTS sounds natural */
export function plainTextForSpeech(text, { maxChars = 900 } = {}) {
  let t = String(text || '');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/_\(([^)]+)\)_/g, '');
  t = t.replace(/^[-•]\s+/gm, '');
  t = t.replace(/^\d+\.\s+/gm, '');
  t = t.replace(/⚠/g, 'Warning:');
  t = t.replace(/₹/g, 'rupees ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > maxChars) {
    t = `${t.slice(0, maxChars).replace(/\s+\S*$/, '')}…`;
  }
  return t;
}

/**
 * @returns {Promise<{ audio: Buffer, contentType: string, chars: number }>}
 */
export async function synthesizeSpeech(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error('ElevenLabs is not configured. Set ELEVENLABS_API_KEY in backend/.env');
    err.status = 503;
    throw err;
  }

  const spoken = plainTextForSpeech(text);
  if (!spoken) {
    const err = new Error('Nothing to speak');
    err.status = 400;
    throw err;
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spoken,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = detail.slice(0, 240) || res.statusText;
    try {
      const parsed = JSON.parse(detail);
      message = parsed.detail?.message || parsed.message || parsed.error || message;
    } catch {
      /* keep text */
    }
    const err = new Error(`ElevenLabs TTS failed (${res.status}): ${message}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') || 'audio/mpeg',
    chars: spoken.length,
    voiceId,
    modelId,
  };
}
