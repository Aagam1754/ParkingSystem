import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API base URL for the ParkLane Express backend.
 * Order: EXPO_PUBLIC_API_URL → app.config extra.apiUrl → LAN / emulator defaults.
 */
function defaultApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, '');

  const fromExtra = Constants.expoConfig?.extra?.apiUrl;
  if (fromExtra) return String(fromExtra).replace(/\/$/, '');

  // Physical Android on same Wi‑Fi as the PC
  if (Platform.OS === 'android') {
    return 'http://192.168.2.224:4000';
  }
  return 'http://localhost:4000';
}

export const API_URL = defaultApiUrl();
