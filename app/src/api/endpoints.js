import { api } from './client';

export const AuthAPI = {
  login: (email, password) =>
    api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => api('/api/auth/me'),
};

export const MeAPI = {
  profile: () => api('/api/me/profile'),
  vehicles: () => api('/api/me/vehicles'),
  setVehicleStatus: (id, status) =>
    api(`/api/me/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  tempClaim: (payload) =>
    api('/api/me/vehicles/temp-claim', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  currentSession: () => api('/api/me/sessions/current'),
  sessions: (limit = 50) => api(`/api/me/sessions?limit=${limit}`),
};
