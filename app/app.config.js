/**
 * Expo config — EXPO_PUBLIC_API_URL is baked in at `expo start` time.
 * Prefer a Cloudflare/ngrok HTTPS URL when testing on a physical phone.
 */
const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.2.224:4000').replace(
  /\/$/,
  ''
);

export default {
  expo: {
    name: 'ParkLane',
    slug: 'parklane',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#0b1210',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'local.parklane.app',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'ParkLane uses your location to guide you to a free parking bay at Eastface.',
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#0b1210',
      },
      package: 'local.parklane.app',
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    },
    plugins: [
      'expo-audio',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow ParkLane to use your location to guide you to a free parking bay at Eastface.',
        },
      ],
    ],
    extra: {
      apiUrl,
    },
  },
};
