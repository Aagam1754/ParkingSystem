import { Platform } from 'react-native';

/**
 * API base URL for the ParkLane Express backend.
 * Prefer EXPO_PUBLIC_API_URL (set in app/.env or shell) for physical devices / tunnels.
 */
function defaultApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000';
  }
  return 'http://localhost:4000';
}

export const API_URL = defaultApiUrl();
