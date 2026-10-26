import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState, StatusBadge } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import type { Account, Supplier } from '../api/types';
import { ProductPicker } from '../components/ProductPicker';
import { DeleteButton } from '../components/DeleteButton';
import { PaymentStatusFields, type PayStatus } from '../components/PaymentStatusFields';
import { EditInvoiceButton } from '../components/EditInvoiceButton';
import { PrintInvoiceButton } from '../components/PrintInvoiceButton';
import { PartyDetail, type PartyRef } from '../components/PartyDetail';
import { ReceiveOrderModal, outstandingOf } from '../components/ReceiveOrderModal';
import { DeliveryHistoryModal, DeliveryHistoryButton } from '../components/DeliveryHistory';
import type { Purchase } from '../api/types';

/** "4 of 10 arrived" for the list, without opening the invoice. */
function arrivalSummary(p: Purchase): string {
  const items = p.items ?? [];
  if (items.length === 0) return '';
  const ordered = items.reduce((sum, i) => sum + Number(i.quantity), 0);
  const received = items.reduce((sum, i) => sum + Number(i.quantityReceived ?? 0), 0);
  return `${received} of ${ordered} arrived`;
}

function ArrivalBadge({ purchase }: { purchase: Purchase }) {
  if (purchase.arrivalStatus === 'RECEIVED') return <span className="badge paid">In stock</span>;
  const label = purchase.arrivalStatus === 'PARTIAL' ? 'Part arrived' : 'Pending arrival';
  return (
    <>
      <span className={`badge ${purchase.arrivalStatus === 'PARTIAL' ? 'partial' : 'unpaid'}`}>{label}</span>
      <div className="cell-muted" style={{ fontSize: 11 }}>
        {arrivalSummary(purchase)}
        {purchase.expectedArrivalDate && purchase.arrivalStatus === 'PENDING'
          ? ` - due ${formatDate(purchase.expectedArrivalDate)}`
          : ''}
      </div>
    </>
  );
}

interface LineItem {
  productId: number | '';
  quantity: string;
  unitCost: string;
  discount: string;
  expiryDate: string;
}

export function PurchasesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<PartyRef | null>(null);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [deliveries, setDeliveries] = useState<Purchase | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['purchases'], queryFn: () => api.listPurchases() });

  return (
    <div>
      <div className="page-header">
        <h1>Purchases</h1>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + New purchase
        </button>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load purchases." />}
      {data && data.length === 0 && <EmptyState label="No purchases recorded yet." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Date</th>
                <th>Ref</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Payment</th>
                <th>Arrival</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      className="link-cell"
                      onClick={() => p.supplier && setDetail({ id: p.supplierId, kind: 'SUPPLIER', name: p.supplier.name })}
                    >
                      {p.supplier?.name}
                    </button>
                  </td>
                  <td>{formatDate(p.invoiceDate)}</td>
                  <td className="cell-muted">{p.invoiceNumber}</td>
                  <td className="text-right">{formatMoney(p.total)}</td>
                  <td className="text-right">{formatMoney(p.amountPaid)}</td>
                  <td className="text-right">{formatMoney(p.balance)}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>
                    <ArrivalBadge purchase={p} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                    {p.arrivalStatus !== 'RECEIVED' && (
                      <button className="btn small" onClick={() => setReceiving(p)}>
                        Order arrived
                      </button>
                    )}
                    <DeliveryHistoryButton purchase={p} onOpen={() => setDeliveries(p)} />
                    <PrintInvoiceButton invoiceNumber={p.invoiceNumber} />
                    <EditInvoiceButton
                      kind="purchase"
                      id={p.id}
                      label={`${p.supplier?.name ?? 'invoice'} - ${p.invoiceNumber}`}
                      invalidate={['purchases', 'suppliers']}
                    />
                    <DeleteButton
                      resource="purchases"
                      id={p.id}
                      label={`${p.supplier?.name ?? 'this'} - ${formatMoney(p.total)} (${p.invoiceNumber})`}
                      description="Refused if any of this stock has already been sold - record a purchase return instead."
                      invalidate={['purchases', 'suppliers', 'products']}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <PartyDetail party={detail} onClose={() => setDetail(null)} />}

      {deliveries && <DeliveryHistoryModal purchase={deliveries} onClose={() => setDeliveries(null)} />}

      {receiving && (
        <ReceiveOrderModal
          purchase={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => setReceiving(null)}
        />
      )}

      {showCreate && (
        <NewPurchaseModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['purchases'] });
            qc.invalidateQueries({ queryKey: ['products'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </div>
  );
}

function NewPurchaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: suppliers } = useQuery({ queryKey: ['suppliers', ''], queryFn: () => api.listSuppliers() });
  const { data: products } = useQuery({ queryKey: ['products', { activeOnly: true }], queryFn: () => api.listProducts({ activeOnly: true }) });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIsoDate());
  // Two genuinely different things: goods carried back from the dealer today,
  // versus an order placed for delivery later. Only the first is stock now.
  const [isOrder, setIsOrder] = useState(false);
  const [expectedArrivalDate, setExpectedArrivalDate] = useState('');
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState<LineItem[]>([{ productId: '', quantity: '', unitCost: '', discount: '0', expiryDate: '' }]);
  const [payStatus, setPayStatus] = useState<PayStatus>('UNPAID');
  const [initialPaymentAmount, setInitialPaymentAmount] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  const total = items.reduce((sum, it) => {
    const qty = Number(it.quantity || 0);
    const cost = Number(it.unitCost || 0);
    const disc = Number(it.discount || 0);
    return sum + (qty * cost - disc);
  }, 0) - Number(discount || 0);

  // Capped at the total so an over-typed amount can't create a negative balance.
  const paidNow =
    payStatus === 'PAID' ? total : payStatus === 'PARTIAL' ? Math.min(total, Number(initialPaymentAmount || 0)) : 0;

  const mutation = useMutation({
    mutationFn: () =>
      api.createPurchase({
        supplierId,
        supplierInvoiceNumber: supplierInvoiceNumber || undefined,
        invoiceDate: new Date(invoiceDate).toISOString(),
        isOrder,
        expectedArrivalDate: isOrder && expectedArrivalDate ? expectedArrivalDate : undefined,
        discount: Number(discount || 0),
        items: items
          .filter((it) => it.productId !== '' && Number(it.quantity) > 0)
          .map((it) => ({
            productId: Number(it.productId),
            quantity: Number(it.quantity),
            unitCost: Number(it.unitCost),
            discount: Number(it.discount || 0),
            expiryDate: it.expiryDate ? new Date(it.expiryDate).toISOString() : undefined,
          })),
        initialPayment: paidNow > 0 && accountId
          ? {
              accountId: Number(accountId),
              amount: paidNow,
              method: (accounts ?? []).find((a: Account) => a.id === accountId)?.type === 'BANK' ? 'BANK' : 'CASH',
            }
          : undefined,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create purchase'),
  });

  return (
    <Modal title="New purchase" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!supplierId) return setError('Choose a supplier.');
          if (payStatus !== 'UNPAID' && !accountId) return setError('Choose which account the money goes into.');
          if (payStatus === 'PARTIAL' && paidNow <= 0) return setError('Enter how much is being paid now.');
          mutation.mutate();
        }}
      >
        <div className="seg-choice" role="radiogroup" aria-label="Where are the goods?">
          <button
            type="button"
            role="radio"
            aria-checked={!isOrder}
            className={!isOrder ? 'active' : ''}
            onClick={() => setIsOrder(false)}
          >
            Goods are here
            <span>Stock goes up now</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isOrder}
            className={isOrder ? 'active' : ''}
            onClick={() => setIsOrder(true)}
          >
            Order placed
            <span>Stock waits for arrival</span>
          </button>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Supplier</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')} required>
              <option value="">Select supplier…</option>
              {(suppliers ?? []).map((s: Supplier) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Supplier invoice #</label>
            <input value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} />
          </div>
          <div className="field">
            <label>Invoice date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
          </div>
          {isOrder && (
            <div className="field">
              <label htmlFor="eta">Expected arrival</label>
              <input
                id="eta"
                type="date"
                value={expectedArrivalDate}
                onChange={(e) => setExpectedArrivalDate(e.target.value)}
              />
              <span className="hint">Leave blank if the supplier did not say.</span>
            </div>
          )}
        </div>

        <h4 style={{ marginTop: 16 }}>Items</h4>
        {items.map((item, i) => (
          <div key={i} className="form-grid" style={{ marginBottom: 8, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto' }}>
            <div className="field">
              <label>Product</label>
              <ProductPicker
                products={products ?? []}
                value={item.productId}
                onChange={(p) => updateItem(i, { productId: p?.id ?? '' })}
                required
              />
            </div>
            <div className="field">
              <label>Qty</label>
              <input type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateItem(i, { quantity: e.target.value })} required />
            </div>
            <div className="field">
              <label>Unit cost</label>
              <input type="number" min="0" step="0.01" value={item.unitCost} onChange={(e) => updateItem(i, { unitCost: e.target.value })} required />
            </div>
            <div className="field">
              <label>Discount</label>
              <input type="number" min="0" step="0.01" value={item.discount} onChange={(e) => updateItem(i, { discount: e.target.value })} />
            </div>
            <div className="field">
              <label>Expiry (optional)</label>
              <input type="date" value={item.expiryDate} onChange={(e) => updateItem(i, { expiryDate: e.target.value })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                type="button"
                className="btn secondary small"
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={items.length === 1}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn secondary small"
          onClick={() => setItems((prev) => [...prev, { productId: '', quantity: '', unitCost: '', discount: '0', expiryDate: '' }])}
        >
          + Add item
        </button>

        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Invoice discount</label>
            <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
        </div>

        <PaymentStatusFields
          total={total}
          status={payStatus}
          onStatusChange={setPayStatus}
          amount={initialPaymentAmount}
          onAmountChange={setInitialPaymentAmount}
          accountId={accountId}
          onAccountChange={setAccountId}
          accounts={accounts}
          partyLabel="You pay the supplier"
        />

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save purchase'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
