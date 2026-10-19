import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, describeBalance } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import type { Account, Supplier } from '../api/types';
import { DeleteButton } from '../components/DeleteButton';

interface PaymentRow {
  id: number;
  amount: string;
  paymentDate: string;
  supplier?: Supplier;
  account?: Account;
  notes?: string | null;
}

export function SupplierPaymentsPage() {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({ queryKey: ['suppliers', ''], queryFn: () => api.listSuppliers() });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });
  const { data: payments, isLoading, error } = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: () => api.listSupplierPayments() as Promise<PaymentRow[]>,
  });

  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.createSupplierPayment({
        supplierId,
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
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not record payment'),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Supplier Payments</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Pay a supplier</h3>
        {formError && <ErrorBanner message={formError} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            if (!supplierId || !accountId) return setFormError('Choose a supplier and account.');
            mutation.mutate();
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')} required>
                <option value="">Select supplier…</option>
                {(suppliers ?? []).map((s: Supplier) => (
                  <option key={s.id} value={s.id}>
                    {s.name} - {describeBalance(s.outstandingBalance, 'payable').text}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label>From account</label>
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
          <p className="muted" style={{ fontSize: 12.5 }}>
            Applied to the supplier's oldest outstanding invoices first, automatically.
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
                <th>Supplier</th>
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
                  <td>{p.supplier?.name}</td>
                  <td className="text-right">{formatMoney(p.amount)}</td>
                  <td>{p.account?.name}</td>
                  <td>{p.notes ?? '-'}</td>
                  <td>
                    <DeleteButton
                      resource="supplier-payments"
                      id={p.id}
                      label={`${p.supplier?.name ?? 'Payment'} - ${formatMoney(p.amount)}`}
                      description="The money comes back out of the account it went into, and the balance goes back up."
                      invalidate={['supplier-payments', 'suppliers', 'accounts']}
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
