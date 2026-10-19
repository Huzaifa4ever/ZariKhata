import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { ErrorBanner } from './StatusBits';
import { IconReceive } from './icons';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { formatMoney, todayIsoDate } from '../lib/format';

/**
 * Take money against one specific invoice, from the invoice's own row.
 *
 * Payments could always be recorded on the Receive Payments page, but from
 * there you have to find the invoice again - so an invoice sitting at Unpaid
 * had no obvious way to become Paid. This posts a payment allocated to this
 * invoice, which is what moves its status; the server derives Paid vs Partial
 * from the allocated total, so nothing sets the status directly.
 */
export function RecordPaymentButton({
  kind,
  invoiceId,
  partyId,
  partyName,
  invoiceNumber,
  balance,
}: {
  kind: 'sale' | 'purchase';
  invoiceId: number;
  partyId: number;
  partyName: string;
  invoiceNumber: string;
  balance: string;
}) {
  const isSale = kind === 'sale';
  const due = Number(balance);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(due.toFixed(2)));
  const [accountId, setAccountId] = useState<number | ''>('');
  const [method, setMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        accountId: Number(accountId),
        amount: Number(amount),
        method,
        paymentDate,
        notes: `Payment on ${invoiceNumber}`,
        allocations: [isSale ? { saleId: invoiceId, amount: Number(amount) } : { purchaseId: invoiceId, amount: Number(amount) }],
        ...(isSale ? { farmerId: partyId } : { supplierId: partyId }),
      };
      return isSale ? api.createFarmerPayment(body) : api.createSupplierPayment(body);
    },
    onSuccess: () => {
      setOpen(false);
      for (const k of [
        isSale ? 'sales' : 'purchases',
        isSale ? 'farmers' : 'suppliers',
        isSale ? 'farmer-payments' : 'supplier-payments',
        'accounts',
        'dashboard',
      ]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record that payment.'),
  });

  // Nothing owed, nothing to collect.
  if (due <= 0) return null;

  const entered = Number(amount || 0);
  const remaining = Math.max(0, due - entered);

  return (
    <>
      <button
        className="btn secondary small"
        onClick={() => {
          setAmount(due.toFixed(2));
          setError(null);
          setOpen(true);
        }}
        title={isSale ? `Receive payment for ${invoiceNumber}` : `Pay ${invoiceNumber}`}
      >
        <IconReceive size={14} />
        {isSale ? 'Receive' : 'Pay'}
      </button>

      {open && (
        <Modal title={isSale ? `Receive payment - ${invoiceNumber}` : `Pay supplier - ${invoiceNumber}`} onClose={() => setOpen(false)}>
          {error && <ErrorBanner message={error} />}
          <p className="muted" style={{ marginTop: 0 }}>
            {partyName} · <strong>{formatMoney(due)}</strong> {isSale ? 'still owed on this invoice' : 'still owed to them'}.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (!accountId) return setError('Choose which account the money goes into.');
              if (entered <= 0) return setError('Enter an amount.');
              if (entered > due) return setError(`That is more than the ${formatMoney(due)} outstanding on this invoice.`);
              save.mutate();
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label htmlFor="rp-amount">Amount</label>
                <input
                  id="rp-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  max={due}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                  required
                />
                <span className="hint">
                  {remaining > 0 ? `${formatMoney(remaining)} will still be owed.` : 'This settles the invoice.'}
                </span>
              </div>
              <div className="field">
                <label htmlFor="rp-account">{isSale ? 'Into account' : 'Pay from account'}</label>
                <select
                  id="rp-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
                  required
                >
                  <option value="">Choose…</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rp-method">Method</label>
                <select id="rp-method" value={method} onChange={(e) => setMethod(e.target.value as 'CASH' | 'BANK')}>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank / Online</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="rp-date">Date</label>
                <input id="rp-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
              </div>
            </div>

            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : isSale ? 'Receive payment' : 'Record payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
