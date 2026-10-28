/**
 * What the stock figure is actually made of.
 *
 * One number on the shelf is almost always several batches bought at
 * different times, at different costs, expiring on different dates. "53 in
 * stock" hides the thing that matters most in this trade: 3 of them go off
 * next month and 50 are good for a year.
 *
 * Stock is sold oldest-expiry-first (see consumeBatchesFifo on the server),
 * so the top row of this table is what leaves the shelf next. That ordering
 * is the whole reason near-expiry stock is not a crisis - but only if you can
 * see it coming.
 */
import { useQuery } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, ErrorBanner, EmptyState } from './StatusBits';
import * as api from '../api/resources';
import { formatMoney, formatDate } from '../lib/format';
import type { ProductBatch } from '../api/types';

/** Days from today, in whole days, negative once it is in the past. */
function daysUntil(iso: string): number {
  const then = new Date(`${iso.slice(0, 10)}T12:00:00+05:00`).getTime();
  const now = new Date().setHours(12, 0, 0, 0);
  return Math.round((then - now) / 86_400_000);
}

function expiryNote(batch: ProductBatch): { text: string; tone: '' | 'warn' | 'danger' } {
  if (!batch.expiryDate) return { text: 'no expiry recorded', tone: '' };
  const days = daysUntil(batch.expiryDate);
  if (days < 0) return { text: `expired ${Math.abs(days)} day(s) ago`, tone: 'danger' };
  if (days === 0) return { text: 'expires today', tone: 'danger' };
  if (days <= 60) return { text: `${days} day(s) left`, tone: 'warn' };
  return { text: `${days} day(s) left`, tone: '' };
}

export function StockBatchesModal({
  productId,
  productName,
  onClose,
}: {
  productId: number;
  productName: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.getProduct(productId),
  });

  const batches = (((data as any)?.batches ?? []) as ProductBatch[])
    .filter((b) => Number(b.quantityRemaining) > 0)
    // Same order the server sells them in: soonest expiry leaves first.
    .sort((a, b) => {
      if (!a.expiryDate && !b.expiryDate) return 0;
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    });

  const total = batches.reduce((sum, b) => sum + Number(b.quantityRemaining), 0);
  const unit = (data as any)?.unit ?? '';
  const atRisk = batches
    .filter((b) => b.expiryDate && daysUntil(b.expiryDate) <= 60)
    .reduce((sum, b) => sum + Number(b.quantityRemaining), 0);

  return (
    <Modal title={`Stock in hand - ${productName}`} onClose={onClose}>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load this product's stock." />}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">On the shelf</div>
              <div className="value">
                {total} {unit}
              </div>
              <div className="hint">across {batches.length} batch(es)</div>
            </div>
            <div className={`stat-card${atRisk > 0 ? ' warn' : ''}`}>
              <div className="label">Expiring within 60 days</div>
              <div className="value">
                {atRisk} {unit}
              </div>
              <div className="hint">{atRisk > 0 ? 'sells first' : 'nothing near expiry'}</div>
            </div>
          </div>

          {batches.length === 0 ? (
            <EmptyState label="Nothing on the shelf for this product." />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Expiry</th>
                    <th>Batch</th>
                    <th className="text-right">Left</th>
                    <th className="text-right">Of</th>
                    <th className="text-right">Cost each</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => {
                    const note = expiryNote(b);
                    return (
                      <tr key={b.id}>
                        <td>
                          {b.expiryDate ? formatDate(b.expiryDate) : '-'}
                          <div className={`cell-muted${note.tone ? ` batch-${note.tone}` : ''}`} style={{ fontSize: 11.5 }}>
                            {i === 0 ? `${note.text} - sells next` : note.text}
                          </div>
                        </td>
                        <td className="cell-muted">{b.batchNumber || '-'}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>
                          {Number(b.quantityRemaining)} {unit}
                        </td>
                        <td className="text-right cell-muted">{Number(b.quantityReceived)}</td>
                        <td className="text-right">{formatMoney(b.purchaseCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="muted-3" style={{ fontSize: 12, marginTop: 10 }}>
            Stock leaves the shelf oldest-expiry first, so the top row is what sells next. Cost is
            taken from whichever batch a sale actually draws on.
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
