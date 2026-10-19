import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState, StatusBadge } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import type { Account, Farmer, Product } from '../api/types';
import { DeleteButton } from '../components/DeleteButton';
import { PaymentStatusFields, type PayStatus } from '../components/PaymentStatusFields';
import { EditInvoiceButton } from '../components/EditInvoiceButton';
import { RecordPaymentButton } from '../components/RecordPaymentButton';
import { FarmerProductsModal } from '../components/FarmerProductsModal';

interface LineItem {
  productId: number | '';
  quantity: string;
  unitPrice: string;
  discount: string;
}

export function SalesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ id: number; name: string } | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['sales'], queryFn: () => api.listSales() });

  return (
    <div>
      <div className="page-header">
        <h1>Sales</h1>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + New sale
        </button>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load sales." />}
      {data && data.length === 0 && <EmptyState label="No sales recorded yet." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Farmer</th>
                <th>Date</th>
                <th>Ref</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button
                      className="link-cell"
                      onClick={() => s.farmer && setHistoryFor({ id: s.farmerId, name: s.farmer.name })}
                      title={`What ${s.farmer?.name ?? 'this farmer'} buys`}
                    >
                      {s.farmer?.name}
                    </button>
                  </td>
                  <td>{formatDate(s.invoiceDate)}</td>
                  <td className="cell-muted">{s.invoiceNumber}</td>
                  <td className="text-right">{formatMoney(s.total)}</td>
                  <td className="text-right">{formatMoney(s.amountPaid)}</td>
                  <td className="text-right">{formatMoney(s.balance)}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                    <RecordPaymentButton
                      kind="sale"
                      invoiceId={s.id}
                      partyId={s.farmerId}
                      partyName={s.farmer?.name ?? ''}
                      invoiceNumber={s.invoiceNumber}
                      balance={s.balance}
                    />
                    <EditInvoiceButton
                      kind="sale"
                      id={s.id}
                      label={`${s.farmer?.name ?? 'invoice'} - ${s.invoiceNumber}`}
                      invalidate={['sales', 'farmers']}
                    />
                    <DeleteButton
                      resource="sales"
                      id={s.id}
                      label={`${s.farmer?.name ?? 'this'} - ${formatMoney(s.total)} (${s.invoiceNumber})`}
                      description="Stock goes back to the batch it came from, and any payment allocated to this invoice becomes unallocated."
                      invalidate={['sales', 'farmers', 'products']}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyFor && (
        <FarmerProductsModal farmer={historyFor} onClose={() => setHistoryFor(null)} />
      )}

      {showCreate && (
        <NewSaleModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['sales'] });
            qc.invalidateQueries({ queryKey: ['products'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </div>
  );
}

function NewSaleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: farmers } = useQuery({ queryKey: ['farmers', ''], queryFn: () => api.listFarmers() });
  const { data: products } = useQuery({ queryKey: ['products', { activeOnly: true }], queryFn: () => api.listProducts({ activeOnly: true }) });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.listAccounts });

  const [farmerId, setFarmerId] = useState<number | ''>('');
  const [invoiceDate, setInvoiceDate] = useState(todayIsoDate());
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState<LineItem[]>([{ productId: '', quantity: '', unitPrice: '', discount: '0' }]);
  const [payStatus, setPayStatus] = useState<PayStatus>('UNPAID');
  const [initialPaymentAmount, setInitialPaymentAmount] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const subtotal = items.reduce((sum, it) => {
    const qty = Number(it.quantity || 0);
    const price = Number(it.unitPrice || 0);
    const disc = Number(it.discount || 0);
    return sum + (qty * price - disc);
  }, 0);
  const total = Math.max(0, subtotal - Number(discount || 0));
  // Capped at the total so an over-typed amount can't create a negative balance.
  const paidNow =
    payStatus === 'PAID' ? total : payStatus === 'PARTIAL' ? Math.min(total, Number(initialPaymentAmount || 0)) : 0;

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function onProductPick(index: number, productId: number) {
    const product = productById.get(productId);
    updateItem(index, { productId, unitPrice: product?.sellingPrice ?? '' });
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.createSale({
        farmerId,
        invoiceDate: new Date(invoiceDate).toISOString(),
        discount: Number(discount || 0),
        items: items
          .filter((it) => it.productId !== '' && Number(it.quantity) > 0)
          .map((it) => ({
            productId: Number(it.productId),
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            discount: Number(it.discount || 0),
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
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create sale'),
  });

  return (
    <Modal title="New sale" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!farmerId) return setError('Choose a farmer.');
          if (payStatus !== 'UNPAID' && !accountId) return setError('Choose which account the money goes into.');
          if (payStatus === 'PARTIAL' && paidNow <= 0) return setError('Enter how much is being paid now.');
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
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Invoice date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
          </div>
        </div>

        <h4 style={{ marginTop: 16 }}>Items</h4>
        {items.map((item, i) => (
          <div key={i} className="form-grid" style={{ marginBottom: 8, gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
            <div className="field">
              <label>Product</label>
              <select
                value={item.productId}
                onChange={(e) => onProductPick(i, Number(e.target.value))}
                required
              >
                <option value="">Select…</option>
                {(products ?? []).map((p: Product) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.currentStock} {p.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Qty</label>
              <input type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateItem(i, { quantity: e.target.value })} required />
            </div>
            <div className="field">
              <label>Unit price</label>
              <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(i, { unitPrice: e.target.value })} required />
            </div>
            <div className="field">
              <label>Discount</label>
              <input type="number" min="0" step="0.01" value={item.discount} onChange={(e) => updateItem(i, { discount: e.target.value })} />
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
          onClick={() => setItems((prev) => [...prev, { productId: '', quantity: '', unitPrice: '', discount: '0' }])}
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
          partyLabel="Farmer pays"
        />

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
