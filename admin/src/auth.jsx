import { createContext, useContext, useEffect, useState } from 'react';
import { AuthAPI } from './api';
import { clearAuthToken, getAuthToken, setAuthToken } from './storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Always clear leftover localStorage logins from older builds
    localStorage.removeItem('parking_token');

    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }
    AuthAPI.me()
      .then(setUser)
      .catch(() => clearAuthToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await AuthAPI.login(email, password);
    setAuthToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    clearAuthToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
