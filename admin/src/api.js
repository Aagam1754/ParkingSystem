const API_BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('parking_token');
}

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
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
