import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthAPI, MeAPI } from '../api/endpoints';
import { getToken, setToken } from '../api/client';

const AuthContext = createContext(null);

const MEMBER_ROLES = new Set(['CORPORATE_MEMBER']);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const p = await MeAPI.profile();
    setProfile(p);
    setUser({
      id: p.id,
      email: p.email,
      fullName: p.fullName,
      role: p.role,
      companyId: p.companyId,
    });
    return p;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const me = await AuthAPI.me();
        if (!MEMBER_ROLES.has(me.role)) {
          await setToken(null);
          return;
        }
        if (!cancelled) {
          setUser(me);
          const p = await MeAPI.profile();
          if (!cancelled) setProfile(p);
        }
      } catch {
        await setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await AuthAPI.login(email, password);
    if (!MEMBER_ROLES.has(data.user?.role)) {
      throw new Error('This app is for corporate members. Admins use the web control panel.');
    }
    await setToken(data.token);
    setUser(data.user);
    const p = await MeAPI.profile();
    setProfile(p);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ user, profile, loading, login, logout, refreshProfile }),
    [user, profile, loading, login, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
