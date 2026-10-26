/**
 * Confirming that an order has turned up.
 *
 * The shopkeeper counts what came off the van and types it here. Three
 * quantities can come out of a delivery and they are kept apart on purpose:
 *
 *   Received - good stock, goes on the shelf
 *   Damaged  - arrived broken or short; never stocked, credited off the bill
 *   Still to come - the remainder, which stays on order
 *
 * Nothing in this form touches stock until it is saved, and the save is keyed
 * so a double-click (or a flaky connection and a retry) cannot stock the same
 * delivery twice.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { ErrorBanner } from './StatusBits';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { formatMoney, todayIsoDate } from '../lib/format';
import type { Purchase, PurchaseItem } from '../api/types';

interface Row {
  accepted: string;
  rejected: string;
  expiryDate: string;
}

/** Ordered, less everything already settled on that line. */
export function outstandingOf(item: PurchaseItem): number {
  return (
    Number(item.quantity) -
    Number(item.quantityReceived ?? 0) -
    Number(item.quantityRejected ?? 0) -
    Number(item.quantityCancelled ?? 0)
  );
}

export function ReceiveOrderModal({
  purchase,
  onClose,
  onDone,
}: {
  purchase: Purchase;
  onClose: () => void;
  onDone: () => void;
}) {
  const items = (purchase.items ?? []).filter((i) => outstandingOf(i) > 0);
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(
      items.map((i) => [i.id, { accepted: String(outstandingOf(i)), rejected: '', expiryDate: '' }]),
    ),
  );
  const [receivedDate, setReceivedDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState('');
  const [closeOrder, setCloseOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  // Generated once per open, not per click: a retry of the same delivery
  // carries the same key and the server returns the first result.
  const idempotencyKey = useRef(`rcv-${purchase.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  function update(id: number, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const creditBack = useMemo(
    () =>
      items.reduce((sum, item) => {
        const row = rows[item.id];
        const rejected = Number(row?.rejected || 0);
        const remaining = closeOrder
          ? Math.max(0, outstandingOf(item) - Number(row?.accepted || 0) - rejected)
          : 0;
        return sum + (rejected + remaining) * Number(item.unitCost);
      }, 0),
    [items, rows, closeOrder],
  );

  const save = useMutation({
    mutationFn: () =>
      api.receivePurchase(purchase.id, {
        receivedDate,
        notes: notes || undefined,
        closeOrder,
        idempotencyKey: idempotencyKey.current,
        items: items.map((item) => ({
          purchaseItemId: item.id,
          quantityAccepted: Number(rows[item.id]?.accepted || 0),
          quantityRejected: Number(rows[item.id]?.rejected || 0),
          expiryDate: rows[item.id]?.expiryDate || undefined,
        })),
      }),
    onSuccess: () => {
      for (const key of ['purchases', 'products', 'suppliers', 'accounts', 'dashboard', 'reports'])
        qc.invalidateQueries({ queryKey: [key] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record that delivery.'),
  });

  return (
    <Modal title={`Order arrived - ${purchase.invoiceNumber}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <p className="muted" style={{ marginTop: 0 }}>
        From <strong>{purchase.supplier?.name}</strong>. Only the quantities you enter as received go
        into stock.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const anything = items.some(
            (i) => Number(rows[i.id]?.accepted || 0) > 0 || Number(rows[i.id]?.rejected || 0) > 0,
          );
          if (!anything && !closeOrder) return setError('Enter what arrived, or close the order.');
          for (const item of items) {
            const entered = Number(rows[item.id]?.accepted || 0) + Number(rows[item.id]?.rejected || 0);
            if (entered > outstandingOf(item) + 1e-9) {
              return setError(
                `${item.product?.name ?? 'That product'}: only ${outstandingOf(item)} still due, you entered ${entered}.`,
              );
            }
          }
          save.mutate();
        }}
      >
        <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: 14 }}>
          <table className="data-table receive-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Still due</th>
                <th className="text-right">Received</th>
                <th className="text-right">Damaged</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.product?.name ?? `Product ${item.productId}`}
                    <div className="cell-muted" style={{ fontSize: 11.5 }}>
                      {formatMoney(item.unitCost)} per {item.product?.unit ?? 'unit'}
                    </div>
                  </td>
                  <td className="text-right">{outstandingOf(item)}</td>
                  <td className="text-right">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="cell-input"
                      aria-label={`Received, ${item.product?.name ?? 'item'}`}
                      value={rows[item.id]?.accepted ?? ''}
                      onChange={(e) => update(item.id, { accepted: e.target.value })}
                    />
                  </td>
                  <td className="text-right">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="cell-input"
                      aria-label={`Damaged, ${item.product?.name ?? 'item'}`}
                      value={rows[item.id]?.rejected ?? ''}
                      onChange={(e) => update(item.id, { rejected: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className="cell-input wide"
                      aria-label={`Expiry, ${item.product?.name ?? 'item'}`}
                      value={rows[item.id]?.expiryDate ?? ''}
                      onChange={(e) => update(item.id, { expiryDate: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="rcv-date">Arrived on</label>
            <input id="rcv-date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="rcv-note">Note</label>
            <input id="rcv-note" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Driver, condition, anything worth remembering" />
          </div>
        </div>

        <label className="check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={closeOrder} onChange={(e) => setCloseOrder(e.target.checked)} />
          <span>
            Nothing more is coming - close this order
            <span className="hint" style={{ display: 'block' }}>
              Writes off whatever has not arrived and takes it off the supplier's bill.
            </span>
          </span>
        </label>

        {creditBack > 0 && (
          <div className="callout" style={{ marginTop: 12 }}>
            <div className="row-between">
              <span>Credited back to {purchase.supplier?.name ?? 'the supplier'}</span>
              <span>- {formatMoney(creditBack)}</span>
            </div>
            <p className="muted-3" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Damaged and undelivered goods are taken off the invoice, so you only owe for what you kept.
            </p>
          </div>
        )}

        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : 'Confirm arrival'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
