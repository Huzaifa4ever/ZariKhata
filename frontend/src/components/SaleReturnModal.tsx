/**
 * Taking goods back from a farmer.
 *
 * The accounting was already written and tested; it had simply never been
 * given a screen, so a farmer handing back an unopened bottle had no path
 * through the app at all.
 *
 * Two decisions the form has to get right, because they are different
 * questions that look like one:
 *
 *   condition - a SALEABLE return goes back on the shelf; damaged or expired
 *               goods do not, and the row itself is the record of why that
 *               stock never came back.
 *   refund    - by default the credit just reduces what the farmer owes. Only
 *               tick the cash refund when money actually leaves the drawer.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, ErrorBanner } from './StatusBits';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { formatMoney, formatDate } from '../lib/format';
import { DeleteButton } from './DeleteButton';

type Condition = 'SALEABLE' | 'DAMAGED' | 'EXPIRED';

interface Row {
  qty: string;
  condition: Condition;
}

export function SaleReturnModal({
  saleId,
  onClose,
  onDone,
}: {
  saleId: number;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const { data: sale, isLoading } = useQuery({ queryKey: ['sale', saleId], queryFn: () => api.getSale(saleId) });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  /** Sold, less whatever has already gone back on an earlier return. */
  const lines = useMemo(() => {
    const items = (sale?.items ?? []) as Array<Record<string, any>>;
    const returned = new Map<number, number>();
    for (const r of ((sale as any)?.returns ?? []) as Array<Record<string, any>>) {
      for (const ri of r.items ?? []) {
        returned.set(ri.saleItemId, (returned.get(ri.saleItemId) ?? 0) + Number(ri.quantity));
      }
    }
    return items.map((i) => {
      const sold = Number(i.quantity);
      const already = returned.get(i.id) ?? 0;
      return {
        id: i.id,
        name: i.product?.name ?? `Product ${i.productId}`,
        unit: i.product?.unit ?? '',
        unitPrice: Number(i.unitPrice),
        sold,
        already,
        remaining: Math.max(0, sold - already),
      };
    });
  }, [sale]);

  const past = ((sale as any)?.returns ?? []) as Array<Record<string, any>>;
  const creditTotal = lines.reduce((sum, l) => sum + Number(rows[l.id]?.qty || 0) * l.unitPrice, 0);
  const anyReturnable = lines.some((l) => l.remaining > 0);

  const save = useMutation({
    mutationFn: () =>
      api.createSaleReturn({
        saleId,
        reason: reason || undefined,
        cashRefundAccountId: refund && accountId ? Number(accountId) : undefined,
        items: lines
          .filter((l) => Number(rows[l.id]?.qty || 0) > 0)
          .map((l) => ({
            saleItemId: l.id,
            quantity: Number(rows[l.id].qty),
            condition: rows[l.id].condition,
          })),
      }),
    onSuccess: () => {
      for (const k of ['sales', 'sale', 'products', 'farmers', 'accounts', 'dashboard', 'report', 'party-statement'])
        qc.invalidateQueries({ queryKey: [k] });
      onDone?.();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record that return.'),
  });

  function update(id: number, patch: Partial<Row>) {
    setRows((prev) => ({
      ...prev,
      [id]: { qty: prev[id]?.qty ?? '', condition: prev[id]?.condition ?? 'SALEABLE', ...patch },
    }));
  }

  return (
    <Modal title={`Return goods - ${(sale as any)?.invoiceNumber ?? ''}`} onClose={onClose}>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message={error} />}

      {sale && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const picked = lines.filter((l) => Number(rows[l.id]?.qty || 0) > 0);
            if (picked.length === 0) return setError('Enter how much is coming back.');
            for (const l of picked) {
              if (Number(rows[l.id].qty) > l.remaining + 1e-9) {
                return setError(`${l.name}: only ${l.remaining} ${l.unit} can still be returned.`);
              }
            }
            if (refund && !accountId) return setError('Choose which account the refund comes out of.');
            save.mutate();
          }}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Sold to <strong>{(sale as any).farmer?.name ?? (sale as any).customerName ?? 'a walk-in customer'}</strong>{' '}
            on {formatDate((sale as any).invoiceDate)}.
          </p>

          <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: 14 }}>
            <table className="data-table receive-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Sold</th>
                  <th className="text-right">Can return</th>
                  <th className="text-right">Coming back</th>
                  <th>Condition</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.name}
                      <div className="cell-muted" style={{ fontSize: 11.5 }}>
                        {formatMoney(l.unitPrice)} per {l.unit}
                        {l.already > 0 && ` - ${l.already} already returned`}
                      </div>
                    </td>
                    <td className="text-right">
                      {l.sold} {l.unit}
                    </td>
                    <td className="text-right">{l.remaining}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        min="0"
                        max={l.remaining}
                        step="any"
                        className="cell-input"
                        disabled={l.remaining <= 0}
                        aria-label={`Quantity returned, ${l.name}`}
                        value={rows[l.id]?.qty ?? ''}
                        onChange={(e) => update(l.id, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="cell-input wide"
                        disabled={l.remaining <= 0}
                        aria-label={`Condition, ${l.name}`}
                        value={rows[l.id]?.condition ?? 'SALEABLE'}
                        onChange={(e) => update(l.id, { condition: e.target.value as Condition })}
                      >
                        <option value="SALEABLE">Good - back on the shelf</option>
                        <option value="DAMAGED">Damaged - not resaleable</option>
                        <option value="EXPIRED">Expired - not resaleable</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!anyReturnable && (
            <p className="ledger-empty">Everything on this invoice has already been returned.</p>
          )}

          <div className="form-grid">
            <div className="field">
              <label htmlFor="ret-reason">Reason</label>
              <input
                id="ret-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Wrong item, leaking bottle, crop finished..."
              />
            </div>
          </div>

          <label className="check-row" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
            <span>
              Give the money back now
              <span className="hint" style={{ display: 'block' }}>
                Leave this off to simply reduce what the farmer owes. Tick it only when cash actually
                leaves the drawer.
              </span>
            </span>
          </label>

          {refund && (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="ret-account">Refund out of</label>
                <select
                  id="ret-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
                  required
                >
                  <option value="">Choose...</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {creditTotal > 0 && (
            <div className="callout" style={{ marginTop: 12 }}>
              <div className="row-between" style={{ fontWeight: 600 }}>
                <span>{refund ? 'To be refunded' : 'Credited against this invoice'}</span>
                <span>{formatMoney(creditTotal)}</span>
              </div>
              <p className="muted-3" style={{ fontSize: 12, margin: '6px 0 0' }}>
                Only goods marked good go back into stock. Damaged and expired quantities are
                recorded but never restocked.
              </p>
            </div>
          )}

          {past.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 20 }}>Already returned</div>
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Reason</th>
                      <th className="text-right">Credited</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {past.map((r: any) => (
                      <tr key={r.id}>
                        <td className="cell-muted">{r.returnNumber}</td>
                        <td>{r.reason || '-'}</td>
                        <td className="text-right">{formatMoney(r.totalAmount)}</td>
                        <td>
                          <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                            <DeleteButton
                              resource="sale-returns"
                              id={r.id}
                              label={`return ${r.returnNumber}`}
                              description="Takes the restocked goods back off the shelf and puts the invoice balance back. Refused if that stock has been sold again."
                              invalidate={['sales', 'sale', 'products', 'farmers', 'accounts']}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={save.isPending || !anyReturnable}>
              {save.isPending ? 'Saving...' : 'Record return'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
