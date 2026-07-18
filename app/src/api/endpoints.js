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
  overview: () => api('/api/me/overview'),
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
  retireTemp: (id) =>
    api(`/api/me/vehicles/${id}/retire-temp`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  currentSession: () => api('/api/me/sessions/current'),
  sessions: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.status) params.set('status', opts.status);
    const q = params.toString();
    return api(`/api/me/sessions${q ? `?${q}` : ''}`);
  },
};

/** Same /api/assistant endpoints as the admin panel — member app passes companyCode + asGuest:false. */
export const AssistantAPI = {
  context: () => api('/api/assistant/context'),
  tips: () => api('/api/assistant/tips'),
  voiceStatus: () => api('/api/assistant/voice'),
  chat: (payload) =>
    api('/api/assistant/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  navigate: (payload = {}) =>
    api('/api/assistant/navigate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  estimate: (payload) =>
    api('/api/assistant/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
