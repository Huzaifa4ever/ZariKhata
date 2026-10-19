import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate, describeBalance } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import type { Account, Farmer } from '../api/types';
import { DeleteButton } from '../components/DeleteButton';
import { IconAlert } from '../components/icons';

interface PaymentRow {
  id: number;
  amount: string;
  paymentDate: string;
  method: string;
  farmer?: Farmer;
  account?: Account;
  notes?: string | null;
}

export function FarmerPaymentsPage() {
  const qc = useQueryClient();
  const { data: farmers } = useQuery({ queryKey: ['farmers', ''], queryFn: () => api.listFarmers() });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const { data: payments, isLoading, error } = useQuery({
    queryKey: ['farmer-payments'],
    queryFn: () => api.listFarmerPayments() as Promise<PaymentRow[]>,
  });

  const [farmerId, setFarmerId] = useState<number | ''>('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [allowOverpay, setAllowOverpay] = useState(false);

  const selectedFarmer = (farmers ?? []).find((f: Farmer) => f.id === farmerId);
  const before = describeBalance(selectedFarmer?.outstandingBalance);
  const after = describeBalance(Number(selectedFarmer?.outstandingBalance ?? 0) - Number(amount || 0));
  const owed = Math.max(0, before.amount);
  const overpaying = Number(amount || 0) > owed;

  const mutation = useMutation({
    mutationFn: () =>
      api.createFarmerPayment({
        farmerId,
        accountId,
        amount: Number(amount),
        // Follows the chosen account: paying into the bank is not a cash receipt.
        method: (accounts ?? []).find((a) => a.id === accountId)?.type === 'BANK' ? 'BANK' : 'CASH',
        notes: notes || undefined,
        idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }),
    onSuccess: () => {
      setAmount('');
      setNotes('');
      setAllowOverpay(false);
      qc.invalidateQueries({ queryKey: ['farmer-payments'] });
      qc.invalidateQueries({ queryKey: ['farmers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not record payment'),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Receive Payments from Farmers</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Record a payment</h3>
        {formError && <ErrorBanner message={formError} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            if (!farmerId || !accountId) return setFormError('Choose a farmer and account.');
            if (overpaying && !allowOverpay) {
              return setFormError(
                owed <= 0
                  ? `${selectedFarmer?.name} does not owe anything. Tick the box below if this is a deliberate advance.`
                  : `That is more than the ${formatMoney(owed)} ${selectedFarmer?.name} owes. Tick the box below to keep the extra as credit.`,
              );
            }
            mutation.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Farmer</label>
              <select value={farmerId} onChange={(e) => setFarmerId(e.target.value ? Number(e.target.value) : '')} required>
                <option value="">Select farmer…</option>
                {(farmers ?? []).map((f: Farmer) => (
                  <option key={f.id} value={f.id}>
                    {f.name} - {describeBalance(f.outstandingBalance).text}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label>Into account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')} required>
                <option value="">Select account…</option>
                {(accounts ?? []).map((a: Account) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {selectedFarmer && (
            <div className="pay-summary" style={{ marginTop: 4 }}>
              <div>
                <span className="k">Before</span>
                <span className="v">{before.text}</span>
              </div>
              <div>
                <span className="k">Receiving</span>
                <span className="v">{formatMoney(Number(amount || 0))}</span>
              </div>
              <div className={after.tone === 'owing' ? 'due' : 'settled'}>
                <span className="k">After</span>
                <span className="v">{after.text}</span>
              </div>
            </div>
          )}

          {overpaying && (
            <div className="overpay-warn">
              <IconAlert size={16} />
              <div>
                <strong>
                  {owed <= 0
                    ? `${selectedFarmer?.name} does not owe anything right now.`
                    : `This is more than the ${formatMoney(owed)} ${selectedFarmer?.name} owes.`}
                </strong>
                <p>
                  {formatMoney(Number(amount || 0) - owed)} would be kept as an advance against their
                  next invoice. That is usually a typo or a payment recorded twice - check before saving.
                </p>
                <label className="overpay-confirm">
                  <input
                    type="checkbox"
                    checked={allowOverpay}
                    onChange={(e) => setAllowOverpay(e.target.checked)}
                  />
                  Yes, keep the extra as advance credit
                </label>
              </div>
            </div>
          )}

          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Applied to the farmer's oldest outstanding invoices first, automatically.
          </p>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Record payment'}
          </button>
        </form>
      </div>

      <h3>Recent payments</h3>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load payments." />}
      {payments && payments.length === 0 && <EmptyState label="No payments recorded yet." />}
      {payments && payments.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Farmer</th>
                <th className="text-right">Amount</th>
                <th>Account</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.paymentDate)}</td>
                  <td>{p.farmer?.name}</td>
                  <td className="text-right">{formatMoney(p.amount)}</td>
                  <td>{p.account?.name}</td>
                  <td>{p.notes ?? '-'}</td>
                  <td>
                    <DeleteButton
                      resource="farmer-payments"
                      id={p.id}
                      label={`${p.farmer?.name ?? 'Payment'} - ${formatMoney(p.amount)}`}
                      description="The money comes back out of the account it went into, and the balance goes back up."
                      invalidate={['farmer-payments', 'farmers', 'accounts']}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
