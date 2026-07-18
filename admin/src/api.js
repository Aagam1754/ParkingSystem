import { clearAuthToken, getAuthToken } from './storage';

const API_BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return getAuthToken();
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  // Don't attach stale tokens to login/otp calls
  const isPublicAuth = path.startsWith('/api/auth/login');
  if (token && !isPublicAuth) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error('Cannot reach API. Is the backend running on port 4000?');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !isPublicAuth) {
      clearAuthToken();
    }
    const fallback =
      res.status === 401
        ? 'Unauthorized — please login again'
        : res.status === 413
          ? 'Image too large for scan. Move closer / retry — frame will be compressed.'
          : `Request failed (${res.status})`;
    throw new Error(data.error || fallback);
  }
  return data;
}

export const AuthAPI = {
  login: (email, password) =>
    api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => api('/api/auth/me'),
};

export const DashboardAPI = {
  overview: () => api('/api/dashboard/overview'),
  companies: () => api('/api/dashboard/companies'),
  members: () => api('/api/dashboard/members'),
  incidents: () => api('/api/dashboard/incidents'),
  building: () => api('/api/dashboard/building'),
};

export const BasesAPI = {
  list: () => api('/api/bases'),
  occupancy: (id) => api(`/api/bases/${id}/occupancy`),
};

export const SessionsAPI = {
  list: (status = 'active') => api(`/api/sessions?status=${status}`),
  entryScan: (payload) =>
    api('/api/sessions/entry-scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  exitScan: (payload) =>
    api('/api/sessions/exit-scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  randomEntry: (forceGeneral = false) =>
    api('/api/sessions/demo-random-entry', {
      method: 'POST',
      body: JSON.stringify({ forceGeneral }),
    }),
};

export const VehiclesAPI = {
  list: () => api('/api/vehicles'),
  create: (payload) =>
    api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  setStatus: (id, status) =>
    api(`/api/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

export const AlprAPI = {
  scan: (payload) =>
    api('/api/alpr/scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  checkIn: (payload) =>
    api('/api/alpr/check-in', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  checkOut: (payload) =>
    api('/api/alpr/check-out', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
