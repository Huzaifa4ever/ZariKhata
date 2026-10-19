import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * Admin mode - an owner-only switch that reveals destructive actions.
 *
 * Deletes are hidden behind a deliberate toggle rather than always on, because
 * this is a shop counter: the same screen is used in a hurry, often by someone
 * else, and a stray click on a "delete invoice" button is not recoverable.
 * Turning it on is a conscious act, and it resets to off on every launch.
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
  // Session state, not localStorage: admin mode should never still be on
  // tomorrow morning because someone left it on last night.
  const [on, setOn] = useState(false);

  const available = user?.role === 'OWNER';
  const setEnabled = useCallback((next: boolean) => setOn(next), []);

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
