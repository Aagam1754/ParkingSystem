import * as Location from 'expo-location';

/** Eastface · Ambli Rd / Iscon — keep in sync with backend navigation.js */
export const EASTFACE = { lat: 23.0216, lng: 72.5074, label: 'Eastface lobby' };

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function requestLocationPermission() {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return { granted: true, status: current.status };
  const asked = await Location.requestForegroundPermissionsAsync();
  return { granted: asked.granted, status: asked.status };
}

export async function getMemberLocation() {
  const { granted } = await requestLocationPermission();
  if (!granted) {
    return { ok: false, error: 'Location permission denied', granted: false };
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const meters = haversineMeters(lat, lng, EASTFACE.lat, EASTFACE.lng);
  const km = meters / 1000;
  let proximity = 'FAR';
  if (meters < 80) proximity = 'AT_LOBBY';
  else if (meters < 400) proximity = 'ON_CAMPUS';
  else if (km < 3) proximity = 'NEARBY';

  return {
    ok: true,
    granted: true,
    lat,
    lng,
    accuracy: pos.coords.accuracy,
    distanceMeters: Math.round(meters),
    distanceKm: Math.round(km * 10) / 10,
    proximity,
    label:
      proximity === 'AT_LOBBY'
        ? 'At Eastface lobby'
        : proximity === 'ON_CAMPUS'
          ? `~${Math.round(meters)} m from lobby`
          : `~${Math.round(km * 10) / 10} km from Eastface`,
  };
}
