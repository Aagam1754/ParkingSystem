import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthAPI, MeAPI } from '../api/endpoints';
import { BYPASS_TOKEN, getToken, isBypassToken, onAuthInvalid, setToken } from '../api/client';

const AuthContext = createContext(null);

const MEMBER_ROLES = new Set(['CORPORATE_MEMBER']);

/** Temporary offline demo session (no API). Remove when API is reachable again. */
const BYPASS_PROFILE = {
  id: 9001,
  email: 'priya@yorkie.local',
  fullName: 'Priya Sharma (offline demo)',
  role: 'CORPORATE_MEMBER',
  companyId: 1,
  companyCode: 'YORK',
  companyName: 'York IE',
  companyColor: '#4cc9f0',
  employeeCode: 'YK-DEMO',
  buildingName: 'Eastface',
  buildingCode: 'EASTFACE',
  floorLabel: '2nd floor',
  offline: true,
};

function userFromProfile(p) {
  return {
    id: p.id,
    email: p.email,
    fullName: p.fullName,
    role: p.role,
    companyId: p.companyId,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  const applyBypass = useCallback(async () => {
    await setToken(BYPASS_TOKEN);
    setProfile(BYPASS_PROFILE);
    setUser(userFromProfile(BYPASS_PROFILE));
    return BYPASS_PROFILE;
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = await getToken();
    if (isBypassToken(token)) {
      setProfile(BYPASS_PROFILE);
      setUser(userFromProfile(BYPASS_PROFILE));
      return BYPASS_PROFILE;
    }
    const p = await MeAPI.profile();
    setProfile(p);
    setUser(userFromProfile(p));
    return p;
  }, []);

  useEffect(() => {
    return onAuthInvalid(() => {
      // Don't kick out offline-bypass sessions when API calls fail
      getToken().then((token) => {
        if (isBypassToken(token)) return;
        setUser(null);
        setProfile(null);
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        if (isBypassToken(token)) {
          if (!cancelled) {
            setProfile(BYPASS_PROFILE);
            setUser(userFromProfile(BYPASS_PROFILE));
          }
          return;
        }
        const me = await AuthAPI.me();
        if (!MEMBER_ROLES.has(me.role)) {
          await clearSession();
          return;
        }
        if (!cancelled) {
          setUser(me);
          const p = await MeAPI.profile();
          if (!cancelled) setProfile(p);
        }
      } catch {
        await clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

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

  const loginBypass = useCallback(async () => {
    const p = await applyBypass();
    return userFromProfile(p);
  }, [applyBypass]);

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      login,
      loginBypass,
      logout,
      refreshProfile,
      clearSession,
      isOfflineDemo: Boolean(profile?.offline),
    }),
    [user, profile, loading, login, loginBypass, logout, refreshProfile, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
