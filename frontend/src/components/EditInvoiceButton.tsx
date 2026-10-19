import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminMode } from '../admin/AdminMode';
import { IconEdit, IconPlus, IconTrash } from './icons';
import { Modal } from './Modal';
import { ErrorBanner, LoadingState } from './StatusBits';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { formatMoney } from '../lib/format';

interface Line {
  productId: number | '';
  quantity: string;
  price: string;
  discount: string;
}

/**
 * Edit the lines on an existing invoice.
 *
 * Only the line items, the invoice discount and the date are editable here.
 * Payments are not: money already taken is a separate record with its own
 * history, and the server refuses an edit that would drop the total below
 * what has been paid rather than inventing a credit.
 */
export function EditInvoiceButton({
  kind,
  id,
  label,
  invalidate,
}: {
  kind: 'sale' | 'purchase';
  id: number;
  label: string;
  invalidate: string[];
}) {
  const { enabled } = useAdminMode();
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <>
      <button
        className="btn ghost small icon-only"
        title={`Edit ${label}`}
        aria-label={`Edit ${label}`}
        onClick={() => setOpen(true)}
      >
        <IconEdit size={15} />
      </button>
      {open && (
        <EditInvoiceModal
          kind={kind}
          id={id}
          label={label}
          invalidate={invalidate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EditInvoiceModal({
  kind,
  id,
  label,
  invalidate,
  onClose,
}: {
  kind: 'sale' | 'purchase';
  id: number;
  label: string;
  invalidate: string[];
  onClose: () => void;
}) {
  const isSale = kind === 'sale';
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [discount, setDiscount] = useState('0');
  const [invoiceDate, setInvoiceDate] = useState('');

  const { data: products } = useQuery({
    queryKey: ['products', { activeOnly: true }],
    queryFn: () => api.listProducts({ activeOnly: true }),
  });

  // Load the invoice once, then hand it to local state so edits are local
  // until saved.
  const { isLoading } = useQuery({
    queryKey: [isSale ? 'sale' : 'purchase', id],
    queryFn: async () => {
      const doc: any = isSale ? await api.getSale(id) : await api.getPurchase(id);
      setLines(
        (doc.items ?? []).map((it: any) => ({
          productId: it.productId,
          quantity: String(it.quantity),
          price: String(isSale ? it.unitPrice : it.unitCost),
          discount: String(it.discount ?? 0),
        })),
      );
      setDiscount(String(doc.discount ?? 0));
      setInvoiceDate(String(doc.invoiceDate).slice(0, 10));
      return doc;
    },
  });

  const subtotal = (lines ?? []).reduce(
    (sum, l) => sum + (Number(l.quantity || 0) * Number(l.price || 0) - Number(l.discount || 0)),
    0,
  );
  const total = Math.max(0, subtotal - Number(discount || 0));

  const save = useMutation({
    mutationFn: () => {
      const items = (lines ?? [])
        .filter((l) => l.productId !== '' && Number(l.quantity) > 0)
        .map((l) => ({
          productId: Number(l.productId),
          quantity: Number(l.quantity),
          ...(isSale ? { unitPrice: Number(l.price) } : { unitCost: Number(l.price) }),
          discount: Number(l.discount || 0),
        }));
      const body = { invoiceDate, discount: Number(discount || 0), items };
      return isSale ? api.adminUpdateSale(id, body) : api.adminUpdatePurchase(id, body);
    },
    onSuccess: () => {
      onClose();
      for (const key of [...invalidate, 'dashboard', 'products']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save this invoice.'),
  });

  const update = (i: number, patch: Partial<Line>) =>
    setLines((prev) => (prev ?? []).map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <Modal title={`Edit ${label}`} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      {isLoading || !lines ? (
        <LoadingState label="Loading invoice…" />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!lines.some((l) => l.productId !== '' && Number(l.quantity) > 0)) {
              setError('An invoice needs at least one line.');
              return;
            }
            save.mutate();
          }}
        >
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="inv-date">Invoice date</label>
            <input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
          </div>

          <div className="section-label" style={{ marginTop: 18 }}>Items</div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table bill-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right" style={{ width: 100 }}>Qty</th>
                  <th className="text-right" style={{ width: 120 }}>{isSale ? 'Price' : 'Cost'}</th>
                  <th className="text-right" style={{ width: 110 }}>Discount</th>
                  <th className="text-right" style={{ width: 120 }}>Line total</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        value={l.productId}
                        onChange={(e) => update(i, { productId: e.target.value ? Number(e.target.value) : '' })}
                        style={{ width: '100%', minWidth: 160 }}
                      >
                        <option value="">Select…</option>
                        {products?.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td><input className="cell-num" type="number" step="any" min="0" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                    <td><input className="cell-num" type="number" step="0.01" min="0" value={l.price} onChange={(e) => update(i, { price: e.target.value })} /></td>
                    <td><input className="cell-num" type="number" step="0.01" min="0" value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} /></td>
                    <td className="text-right" style={{ fontWeight: 600 }}>
                      {formatMoney(Number(l.quantity || 0) * Number(l.price || 0) - Number(l.discount || 0))}
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn ghost small icon-only"
                          aria-label={`Remove line ${i + 1}`}
                          onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                        >
                          <IconTrash size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="bill-add-row">
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setLines([...lines, { productId: '', quantity: '1', price: '0', discount: '0' }])}
              >
                <IconPlus size={15} /> Add line
              </button>
            </div>
          </div>

          <div className="bill-footer" style={{ marginTop: 14 }}>
            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="inv-disc">Invoice discount</label>
              <input id="inv-disc" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="card bill-totals">
              <div className="row"><span className="muted">Sub-total</span><span className="num">{formatMoney(subtotal)}</span></div>
              <div className="row grand"><span>New total</span><span className="num">{formatMoney(total)}</span></div>
            </div>
          </div>

          <p className="muted-3" style={{ fontSize: 12, marginTop: 12 }}>
            Stock and the {isSale ? 'farmer' : 'supplier'} balance are recalculated from these lines. Payments
            already recorded stay as they are - if the new total is lower than what has been paid, the save
            is refused.
          </p>

          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save invoice'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
