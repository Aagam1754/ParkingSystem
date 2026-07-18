import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config';

const TOKEN_KEY = 'parklane_member_token';

/** Local-only session marker — no JWT, no API required */
export const BYPASS_TOKEN = '__parklane_offline_bypass__';

export function isBypassToken(token) {
  return token === BYPASS_TOKEN;
}

const authListeners = new Set();

export function onAuthInvalid(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function emitAuthInvalid() {
  authListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token) {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const isPublicAuth = path.startsWith('/api/auth/login');
  const token = await getToken();

  if (isBypassToken(token) && !isPublicAuth) {
    throw new Error('Offline demo mode — API calls are disabled. Reconnect the API to use live data.');
  }

  if (token && !isPublicAuth) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(`Cannot reach API at ${API_URL}. Is the backend running and reachable?`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !isPublicAuth && !isBypassToken(token)) {
      await setToken(null);
      emitAuthInvalid();
    }
    throw new Error(
      data.error ||
        (res.status === 401
          ? 'Unauthorized — please login again'
          : res.status === 503
            ? data.error || 'Service unavailable'
            : `Request failed (${res.status})`)
    );
  }
  return data;
}
