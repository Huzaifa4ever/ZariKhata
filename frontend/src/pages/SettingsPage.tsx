import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { LoadingState, ErrorBanner } from '../components/StatusBits';
import { useAdminMode } from '../admin/AdminMode';
import { Logo } from '../components/Logo';
import { IconAlert } from '../components/icons';
import { ApiError } from '../api/client';
import { formatDate } from '../lib/format';

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['business'], queryFn: api.getBusiness });
  const [form, setForm] = useState({
    name: '', address: '', phone: '',
    salesInvoicePrefix: '', purchaseInvoicePrefix: '',
    lowStockDefaultAlert: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name,
        address: data.address ?? '',
        phone: data.phone ?? '',
        salesInvoicePrefix: data.salesInvoicePrefix,
        purchaseInvoicePrefix: data.purchaseInvoicePrefix,
        lowStockDefaultAlert: String(data.lowStockDefaultAlert),
      });
      // Cache for offline use by print templates
      try {
        localStorage.setItem(
          'zk_business',
          JSON.stringify({ name: data.name, address: data.address, phone: data.phone }),
        );
      } catch { /* quota exceeded - silently skip */ }
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      api.updateBusiness({
        name: form.name,
        address: form.address || undefined,
        phone: form.phone || undefined,
        salesInvoicePrefix: form.salesInvoicePrefix,
        purchaseInvoicePrefix: form.purchaseInvoicePrefix,
        lowStockDefaultAlert: Number(form.lowStockDefaultAlert || 0),
      }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['business'] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save settings'),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Shop details, your login, and admin controls.</p>
        </div>
      </div>

      <div className="settings-layout">
      <div className="settings-col">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Shop details</h3>
        {error && <ErrorBanner message={error} />}
        {saved && <div className="info-banner">Saved.</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Shop name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="field">
              <label>Sales invoice prefix</label>
              <input
                value={form.salesInvoicePrefix}
                onChange={(e) => setForm({ ...form, salesInvoicePrefix: e.target.value.toUpperCase() })}
                maxLength={6}
              />
              <span className="hint">Numbers already issued keep their prefix.</span>
            </div>
            <div className="field">
              <label>Purchase invoice prefix</label>
              <input
                value={form.purchaseInvoicePrefix}
                onChange={(e) => setForm({ ...form, purchaseInvoicePrefix: e.target.value.toUpperCase() })}
                maxLength={6}
              />
            </div>
            <div className="field">
              <label>Default low-stock alert threshold</label>
              <input
                type="number"
                min="0"
                value={form.lowStockDefaultAlert}
                onChange={(e) => setForm({ ...form, lowStockDefaultAlert: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" className="btn" disabled={mutation.isPending} style={{ marginTop: 12 }}>
            {mutation.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </div>

        <AccountCard />
      </div>

      <div className="settings-col">
        <AdminModeCard />
        <RecoveryCodeCard />
        <PrintingCard business={data} />
      </div>
      </div>
    </div>
  );
}

/**
 * Your own account: name, username, email and password. Separate from the
 * Users page, which is the owner managing *other* people - this one is the
 * signed-in person maintaining their own login, so an employee can reach it too.
 */
function AccountCard() {
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: api.getMyProfile });
  const [form, setForm] = useState({ name: '', username: '', email: '' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (me) setForm({ name: me.name, username: me.username, email: me.email ?? '' });
  }, [me]);

  const save = useMutation({
    mutationFn: () =>
      api.updateMyProfile({
        name: form.name,
        username: form.username,
        email: form.email ? form.email : null,
        ...(newPassword ? { currentPassword, newPassword } : {}),
      }),
    onSuccess: (res) => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (res.mustSignInAgain) {
        // Changing the password or username drops every session, including this
        // one - say so plainly instead of letting the next click 401.
        setNotice('Saved. You will need to sign in again with your new details.');
      } else {
        setNotice('Saved.');
        setTimeout(() => setNotice(null), 2500);
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save your account'),
  });

  if (isLoading) return <LoadingState label="Loading your account…" />;

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Your account</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Change how you sign in. Leave the password boxes empty to keep your current password.
      </p>
      {error && <ErrorBanner message={error} />}
      {notice && <div className="info-banner">{notice}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setNotice(null);
          if (newPassword && newPassword !== confirmPassword) {
            setError('The two new passwords do not match.');
            return;
          }
          save.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="acc-name">Your name</label>
            <input id="acc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="acc-username">Username</label>
            <input
              id="acc-username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              minLength={3}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="acc-email">Email (optional)</label>
            <input
              id="acc-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="acc-current">Current password</label>
            <input
              id="acc-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-new">New password</label>
            <input
              id="acc-new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="acc-confirm">Confirm new password</label>
            <input
              id="acc-confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>

        <button type="submit" className="btn" disabled={save.isPending} style={{ marginTop: 14 }}>
          {save.isPending ? 'Saving…' : 'Save account'}
        </button>
      </form>
    </div>
  );
}

/**
 * The switch that reveals delete buttons across the app. Owner-only, and
 * deliberately off again every time the app starts - see admin/AdminMode.
 */
function AdminModeCard() {
  const { enabled, available, setEnabled } = useAdminMode();
  if (!available) return null;

  return (
    <div className={`card admin-card${enabled ? ' on' : ''}`} style={{ marginTop: 20 }}>
      <div className="admin-card-head">
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>Admin mode</h3>
          <p className="muted" style={{ margin: 0 }}>
            Turn this on to show edit and delete buttons on expenses, invoices, payments, deliveries,
            farmers, suppliers, products and users. Only an owner can correct or remove a record -
            staff record new ones. It stays on while this browser is open and clears when you close
            it or sign out.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`switch${enabled ? ' on' : ''}`}
          onClick={() => setEnabled(!enabled)}
        >
          <span className="switch-thumb" />
        </button>
      </div>

      {enabled && (
        <div className="error-banner" style={{ marginTop: 14, marginBottom: 0 }}>
          <IconAlert size={16} />
          <span>
            Admin mode is on. Deleting a record also removes what it posted to your accounts and
            stock - permanently. Records that other entries depend on are refused rather than
            deleted, and you will be told why.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The owner's way back in if they forget their password.
 *
 * There is no email on this system and nobody above the owner to ask, so
 * without this a forgotten password locks the business out of its own books
 * permanently. The code is shown once, here, and never again - it is stored
 * only as a hash, exactly like a password, so not even the server can read it
 * back.
 */
function RecoveryCodeCard() {
  const { available } = useAdminMode();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const status = useQuery({
    queryKey: ['recovery-code'],
    queryFn: api.getRecoveryCodeStatus,
    enabled: available,
  });

  const issue = useMutation({
    mutationFn: () => api.issueRecoveryCode(password),
    onSuccess: (result) => {
      setCode(result.code);
      setPassword('');
      setAsking(false);
      status.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create a recovery code.'),
  });

  if (!available) return null;

  const configured = status.data?.configured ?? false;

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>If you forget your password</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        A recovery code lets you back in without your password. Nobody can reset it for you - there
        is no one above the owner on this system - so keep the code the way you keep the shop keys.
      </p>

      {!configured && !code && (
        <div className="notice-danger" style={{ marginBottom: 12 }}>
          <strong>You have no recovery code.</strong> If you forget your password today, the books
          cannot be opened again. This takes a minute.
        </div>
      )}

      {configured && !code && (
        <p className="muted-3" style={{ fontSize: 13 }}>
          A code was created on {formatDate(status.data?.setAt)}. It works once. Creating a new one
          cancels it.
        </p>
      )}

      {code && (
        <div className="recovery-reveal">
          <div className="recovery-label">Write this down now - it will not be shown again</div>
          <div className="recovery-code">{code}</div>
          <div className="recovery-help">
            Keep it somewhere you would keep a spare key - the cash box, or a photo on your phone.
            Anyone holding it can take over this account, and using it signs out everyone else.
          </div>
          <button type="button" className="btn secondary small" onClick={() => setCode(null)}>
            I have written it down
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {!code && !asking && (
        <button type="button" className="btn secondary" onClick={() => setAsking(true)}>
          {configured ? 'Create a new code' : 'Create a recovery code'}
        </button>
      )}

      {!code && asking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            issue.mutate();
          }}
        >
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="recovery-pw">Confirm your password</label>
            <input
              id="recovery-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            <span className="hint">
              Asked because this code can bypass your password - an unattended counter should not be
              enough to walk away with one.
            </span>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setAsking(false);
                setPassword('');
                setError(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn" disabled={issue.isPending || !password}>
              {issue.isPending ? 'Creating…' : 'Show my code'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * What ends up on printed paperwork, read straight from the shop details so
 * the owner can see the effect of what they just typed without printing a
 * test page.
 */
function PrintingCard({ business }: { business: ReturnType<typeof api.getBusiness> extends Promise<infer T> ? T | undefined : never }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>On printed paperwork</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Reports and A4 statements, plus every counter receipt, carry this heading.
      </p>

      <div className="print-preview">
        <div className="print-preview-brand">
          <Logo size={30} />
          <div>
            <div className="pp-shop">{business?.name || 'Your shop name'}</div>
            {business?.address && <div className="pp-line">{business.address}</div>}
            {business?.phone && <div className="pp-line">Phone: {business.phone}</div>}
            <div className="pp-by">Powered by ZariKhata</div>
          </div>
        </div>
      </div>

      <ul className="list-plain" style={{ marginTop: 14 }}>
        <li>
          <strong>Receipts</strong> print to an 80mm or 58mm thermal roll. Pick the width from the
          Print button on any sale - this browser remembers whichever you used last.
        </li>
        <li>
          <strong>Reports and statements</strong> print A4. Use your printer dialog's "Save as PDF" to
          keep a copy.
        </li>
        <li>
          Invoice prefixes only affect numbers issued from now on - paperwork already given out keeps
          the number printed on it.
        </li>
      </ul>
    </div>
  );
}
