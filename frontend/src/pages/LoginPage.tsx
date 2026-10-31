import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorBanner } from '../components/StatusBits';
import { ApiError } from '../api/client';
import * as api from '../api/resources';

export function LoginPage() {
  const { login, expired } = useAuth();
  const [recovering, setRecovering] = useState(false);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  if (recovering) {
    return <RecoverPanel onDone={() => setRecovering(false)} />;
  }

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="muted">Sign in to open your shop's books.</p>

      {/* The session can die mid-shift. Say so, rather than letting the user
          wonder why they were thrown out. */}
      {expired && (
        <div className="callout" style={{ marginBottom: 14 }}>
          Your session ended, so you were signed out. Nothing you had saved is affected.
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <form onSubmit={onSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn large block" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <button type="button" className="auth-link" onClick={() => setRecovering(true)}>
        Forgot your password?
      </button>
    </AuthLayout>
  );
}

/**
 * Getting back in with the recovery code.
 *
 * Owner only, and single use: the code is cleared the moment it works, every
 * session is ended, and Settings asks for a new one on the way back in.
 */
function RecoverPanel({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError('The two passwords do not match.');
    if (newPassword.length < 8) return setError('Pick a password of at least 8 characters.');
    setSubmitting(true);
    try {
      await api.recoverPassword({ username: username.trim(), code, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <h1>Password changed</h1>
        <p className="muted">
          Sign in with your new password. That recovery code has now been used up - create a fresh
          one from Settings once you are back in.
        </p>
        <button className="btn large block" type="button" onClick={onDone}>
          Back to sign in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Use your recovery code</h1>
      <p className="muted">
        The code you were shown in Settings when you set this up. Only the owner has one, and it
        works once.
      </p>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={onSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="rec-user">Username</label>
          <input
            id="rec-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="rec-code">Recovery code</label>
          <input
            id="rec-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            required
          />
          <span className="hint">Dashes, spaces and capitals do not matter.</span>
        </div>
        <div className="field">
          <label htmlFor="rec-new">New password</label>
          <input
            id="rec-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="rec-confirm">Type it again</label>
          <input
            id="rec-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <button className="btn large block" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : 'Set new password'}
        </button>
      </form>

      <button type="button" className="auth-link" onClick={onDone}>
        Back to sign in
      </button>
    </AuthLayout>
  );
}
