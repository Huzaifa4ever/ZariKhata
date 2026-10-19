import { formatMoney } from '../lib/format';
import type { Account } from '../api/types';

export type PayStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

/**
 * Payment side of a new invoice.
 *
 * Everything used to default to Unpaid because the form only had an optional
 * "initial payment" box that nobody filled in. Asking the question directly -
 * unpaid, part-paid, or settled - means the status on the invoice reflects
 * what actually happened at the counter. "Paid" fills the amount in for you;
 * "Partial" asks how much and shows what is still owed.
 */
export function PaymentStatusFields({
  total,
  status,
  onStatusChange,
  amount,
  onAmountChange,
  accountId,
  onAccountChange,
  accounts,
  partyLabel,
}: {
  total: number;
  status: PayStatus;
  onStatusChange: (s: PayStatus) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  accountId: number | '';
  onAccountChange: (v: number | '') => void;
  accounts: Account[] | undefined;
  /** "Farmer pays" vs "You pay" wording. */
  partyLabel: string;
}) {
  const paidNow = status === 'PAID' ? total : status === 'PARTIAL' ? Number(amount || 0) : 0;
  const remaining = Math.max(0, total - paidNow);
  const overpaid = paidNow > total;

  return (
    <div className="pay-block">
      <div className="field">
        <label>{partyLabel}</label>
        <div className="segmented pay-switch">
          {(
            [
              ['UNPAID', 'Unpaid'],
              ['PARTIAL', 'Part paid'],
              ['PAID', 'Paid in full'],
            ] as Array<[PayStatus, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={status === value ? 'active' : ''}
              onClick={() => onStatusChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {status !== 'UNPAID' && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="pay-amount">Amount now</label>
            <input
              id="pay-amount"
              type="number"
              min="0"
              step="0.01"
              max={total || undefined}
              value={status === 'PAID' ? total.toFixed(2) : amount}
              disabled={status === 'PAID'}
              onChange={(e) => onAmountChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pay-account">Into account</label>
            <select
              id="pay-account"
              value={accountId}
              onChange={(e) => onAccountChange(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">Choose…</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="pay-summary">
        <div>
          <span className="k">Invoice total</span>
          <span className="v">{formatMoney(total)}</span>
        </div>
        <div>
          <span className="k">Paying now</span>
          <span className="v">{formatMoney(paidNow)}</span>
        </div>
        <div className={remaining > 0 ? 'due' : 'settled'}>
          <span className="k">{remaining > 0 ? 'Still owed' : 'Settled'}</span>
          <span className="v">{formatMoney(remaining)}</span>
        </div>
      </div>

      {overpaid && (
        <p className="muted-3" style={{ fontSize: 12, marginTop: 6 }}>
          That is more than the invoice total - it will be capped at {formatMoney(total)}.
        </p>
      )}
    </div>
  );
}
