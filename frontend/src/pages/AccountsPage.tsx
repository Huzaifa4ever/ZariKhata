import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import { AccountStatementModal } from '../components/AccountStatementModal';
import type { Account } from '../api/types';

export function AccountsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<Account | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  const short = (data ?? []).filter((a) => Number(a.balance ?? 0) < 0);

  return (
    <div>
      <div className="page-header">
        <h1>Accounts</h1>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + Add account
        </button>
      </div>

      {/* A negative cash balance is not a number, it is a problem. It used to
          sit in the same white type as a healthy one under the words "what you
          can spend today". */}
      {short.length > 0 && (
        <div className="notice-danger" style={{ marginBottom: 'var(--s-3)' }}>
          <strong>
            {short.length === 1
              ? `${short[0].name} is overdrawn.`
              : `${short.length} accounts are overdrawn.`}
          </strong>{' '}
          More has been paid out than was ever recorded coming in - open the cash book to find the
          entry that put it there. Usually it is money received that was never entered.
        </div>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load accounts." />}
      {data && data.length === 0 && <EmptyState label="No accounts yet." />}
      {data && data.length > 0 && (
        <div className="stat-grid">
          {data.map((a) => {
            const balance = Number(a.balance ?? 0);
            return (
              <button
                key={a.id}
                type="button"
                className={`stat-card as-button${balance < 0 ? ' danger' : ''}`}
                onClick={() => setViewing(a)}
              >
                <div className="label">
                  {a.name} ({a.type === 'CASH' ? 'Cash' : 'Bank'})
                </div>
                <div className={`value${balance < 0 ? ' amount-negative' : ''}`}>
                  {formatMoney(a.balance)}
                </div>
                <div className="hint">
                  {balance < 0 ? 'overdrawn - open the cash book' : 'open the cash book'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {viewing && <AccountStatementModal account={viewing} onClose={() => setViewing(null)} />}

      {showCreate && (
        <CreateAccountModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      )}
    </div>
  );
}

function CreateAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('CASH');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.createAccount({ name, type, openingBalance: Number(openingBalance || 0) }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create account'),
  });

  return (
    <Modal title="Add account" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
            </select>
          </div>
          <div className="field">
            <label>Opening balance</label>
            <input type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
