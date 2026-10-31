/**
 * The cash book for one account.
 *
 * This report was written months ago and reachable from nowhere - the Accounts
 * page showed a single number per account and stopped there, which is exactly
 * the screen you need when that number is wrong. Every line that moved the
 * balance is here, in order, with the balance as it stood after each one, so a
 * figure that looks wrong can be traced to the entry that made it wrong.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, ErrorBanner, EmptyState } from './StatusBits';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import type { Account } from '../api/types';

/** "FarmerPayment" is not a sentence. Say what actually happened. */
const SOURCE_LABEL: Record<string, string> = {
  Sale: 'Counter sale',
  FarmerPayment: 'Received from farmer',
  SupplierPayment: 'Paid to supplier',
  Expense: 'Expense',
  SaleReturn: 'Refund on return',
  PurchaseReturn: 'Refund from supplier',
  EmployeeAdvance: 'Advance to staff',
  PurchaseReceipt: 'Delivery adjustment',
};

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
}

export function AccountStatementModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [from, setFrom] = useState(() => monthsAgoIso(3));
  const [to, setTo] = useState(todayIsoDate);

  const { data, isLoading, error } = useQuery({
    queryKey: ['account-statement', account.id],
    queryFn: () => api.getAccountStatement(account.id),
  });

  // Filtered in the browser rather than refetched: the running balance has to
  // be computed from the very first entry to mean anything, so the server
  // always sends the whole history and the date box only narrows what is
  // shown.
  const rows = useMemo(() => {
    const all = data?.transactions ?? [];
    return all
      .filter((t) => {
        const day = t.txnDate.slice(0, 10);
        return (!from || day >= from) && (!to || day <= to);
      })
      .reverse();
  }, [data, from, to]);

  const moneyIn = rows
    .filter((t) => t.direction === 'CREDIT')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const moneyOut = rows
    .filter((t) => t.direction === 'DEBIT')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const balance = Number(data?.account.balance ?? account.balance ?? 0);

  return (
    <Modal title={`Cash book - ${account.name}`} onClose={onClose} wide>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load this account's history." />}

      {data && (
        <>
          <div className="stat-grid">
            <div className={`stat-card${balance < 0 ? ' danger' : ''}`}>
              <div className="label">Balance now</div>
              <div className="value">{formatMoney(balance)}</div>
              <div className="hint">
                {balance < 0 ? 'more has gone out than came in' : 'across the whole history'}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">In, over this period</div>
              <div className="value">{formatMoney(moneyIn)}</div>
            </div>
            <div className="stat-card">
              <div className="label">Out, over this period</div>
              <div className="value">{formatMoney(moneyOut)}</div>
            </div>
          </div>

          <div className="filter-bar">
            <label className="field inline">
              <span>From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field inline">
              <span>To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Whole history
            </button>
          </div>

          {rows.length === 0 ? (
            <EmptyState label="Nothing moved through this account in that period." />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What it was</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Out</th>
                    <th className="text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const credit = t.direction === 'CREDIT';
                    const after = Number(t.runningBalance);
                    return (
                      <tr key={t.id}>
                        <td>{formatDate(t.txnDate)}</td>
                        <td>
                          {t.description || SOURCE_LABEL[t.relatedType] || t.relatedType}
                          <div className="cell-muted" style={{ fontSize: 11.5 }}>
                            {SOURCE_LABEL[t.relatedType] ?? t.relatedType}
                          </div>
                        </td>
                        <td className="text-right">{credit ? formatMoney(t.amount) : ''}</td>
                        <td className="text-right">{credit ? '' : formatMoney(t.amount)}</td>
                        <td className={`text-right${after < 0 ? ' amount-negative' : ''}`} style={{ fontWeight: 600 }}>
                          {formatMoney(after)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted-3" style={{ fontSize: 12, marginTop: 10 }}>
            Newest first. "Balance after" is what the account held once that entry was recorded, so
            the row where it first turns negative is where to look.
          </p>

          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
