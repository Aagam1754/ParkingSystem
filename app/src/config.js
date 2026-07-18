import { Platform } from 'react-native';

/**
 * API base URL for the ParkLane Express backend.
 * - iOS simulator: localhost works
 * - Android emulator: use 10.0.2.2 (host loopback)
 * - Physical device: set EXPO_PUBLIC_API_URL to your machine LAN IP, e.g. http://192.168.1.10:4000
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
