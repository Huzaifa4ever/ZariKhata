import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

const ADMIN_MODE_KEY = 'zarikhata_admin_mode';

/**
 * Admin mode - an owner-only switch that reveals destructive actions.
 *
 * Deletes are hidden behind a deliberate toggle rather than always on, because
 * this is a shop counter: the same screen is used in a hurry, often by someone
 * else, and a stray click on a "delete invoice" button is not recoverable.
 * Turning it on is a conscious act.
 *
 * It survives a reload but not a new browser session, which is the balance
 * that actually works at a counter: having to walk back to Settings after
 * every refresh made correcting a typo so tedious that it was easier to leave
 * the wrong number in the books. It still clears when the browser closes, so
 * it is never silently on the next morning, and it clears on sign-out.
 */
interface AdminModeValue {
  /** True only when the signed-in user is an OWNER *and* has switched it on. */
  enabled: boolean;
  /** Whether the current user is even allowed to switch it on. */
  available: boolean;
  setEnabled: (on: boolean) => void;
}

const AdminModeContext = createContext<AdminModeValue | null>(null);

export function AdminModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // sessionStorage, not localStorage: it dies with the browser session, so
  // admin mode is never still on tomorrow morning.
  const [on, setOn] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_MODE_KEY) === 'on';
    } catch {
      return false;
    }
  });

  const available = user?.role === 'OWNER';

  const setEnabled = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) sessionStorage.setItem(ADMIN_MODE_KEY, 'on');
      else sessionStorage.removeItem(ADMIN_MODE_KEY);
    } catch {
      // Storage blocked - the toggle still works for this page view.
    }
  }, []);

  // Signing out must not hand admin mode to whoever logs in next.
  useEffect(() => {
    if (!user) setEnabled(false);
  }, [user, setEnabled]);

  const value = useMemo(
    () => ({ enabled: available && on, available, setEnabled }),
    [available, on, setEnabled],
  );

  return <AdminModeContext.Provider value={value}>{children}</AdminModeContext.Provider>;
}

export function useAdminMode(): AdminModeValue {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error('useAdminMode must be used inside <AdminModeProvider>');
  return ctx;
}
