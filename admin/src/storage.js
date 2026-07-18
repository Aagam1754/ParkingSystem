/**
 * Auth token in localStorage so multiple tabs/screens in the same browser
 * share one login (check-in + user display + map together).
 */
const TOKEN_KEY = 'parking_token';

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  // clean any older sessionStorage copy
  sessionStorage.removeItem(TOKEN_KEY);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}
