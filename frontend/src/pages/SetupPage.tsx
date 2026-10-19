import { useState, type FormEvent } from 'react';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorBanner } from '../components/StatusBits';
import { setToken, ApiError } from '../api/client';
import * as api from '../api/resources';

export function SetupPage({ onDone }: { onDone: () => void }) {
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.performSetup({ shopName, ownerName, username, password });
      setToken(result.token);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not complete setup. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Set up your shop</h1>
      <p className="muted">This happens once. Everything you enter stays on this computer.</p>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={onSubmit} className="auth-form">
        <div className="field">
          <label htmlFor="shopName">Shop name</label>
          <input
            id="shopName"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="e.g. Al-Noor Agro Centre"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="ownerName">Your name</label>
          <input
            id="ownerName"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="username">Choose a username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            minLength={3}
            required
          />
          <span className="hint">You'll use this to sign in - at least 3 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="password">Choose a password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <span className="hint">At least 8 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <button className="btn large block" type="submit" disabled={submitting}>
          {submitting ? 'Setting up…' : 'Create my shop'}
        </button>
      </form>
    </AuthLayout>
  );
}
