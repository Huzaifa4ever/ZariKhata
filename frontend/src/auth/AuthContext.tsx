import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from '../api/resources';
import { getToken, setToken, SESSION_EXPIRED_EVENT } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Set when the session died on its own rather than by signing out. */
  expired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  // The session can end mid-shift. Rather than leaving every screen stuck on
  // "could not load", drop to the login form and say why.
  useEffect(() => {
    function onExpired() {
      setUser((current) => {
        if (current) setExpired(true);
        return null;
      });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(username: string, password: string) {
    const result = await api.login(username, password);
    setToken(result.token);
    setUser(result.user);
    setExpired(false);
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // Even if the network call fails, clear local state so the UI doesn't get stuck.
    }
    setToken(null);
    setUser(null);
    setExpired(false);
  }

  return <AuthContext.Provider value={{ user, loading, expired, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
