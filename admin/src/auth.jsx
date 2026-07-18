import { createContext, useContext, useEffect, useState } from 'react';
import { AuthAPI } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('parking_token');
    if (!token) {
      setLoading(false);
      return;
    }
    AuthAPI.me()
      .then(setUser)
      .catch(() => localStorage.removeItem('parking_token'))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await AuthAPI.login(email, password);
    localStorage.setItem('parking_token', data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('parking_token');
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
