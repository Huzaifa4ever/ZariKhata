import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState, StatusBadge } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import type { Account, Farmer, Product } from '../api/types';
import { ProductPicker } from '../components/ProductPicker';
import { FarmerPicker } from '../components/FarmerPicker';
import { DeleteButton } from '../components/DeleteButton';
import { PaymentStatusFields, type PayStatus } from '../components/PaymentStatusFields';
import { EditInvoiceButton } from '../components/EditInvoiceButton';
import { PrintInvoiceButton } from '../components/PrintInvoiceButton';
import { PartyDetail, type PartyRef } from '../components/PartyDetail';
import { SaleReturnModal } from '../components/SaleReturnModal';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { FilterBar, usePaged, textMatches, withinRange, type DateRange } from '../components/LedgerFilters';

interface LineItem {
  productId: number | '';
  quantity: string;
  unitPrice: string;
  discount: string;
}

export function SalesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<PartyRef | null>(null);
  const [returning, setReturning] = useState<number | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [status, setStatus] = useState('');
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['sales'], queryFn: () => api.listSales() });

  const filtered = useMemo(() => {
    const all = data ?? [];
    return all.filter((s) => {
      if (status && s.status !== status) return false;
      if (!withinRange(s.invoiceDate, range)) return false;
      if (!search.trim()) return true;
      // Invoice number, farmer, or the name written on a counter sale -
      // whichever the shopkeeper happens to remember.
      return textMatches(
        `${s.invoiceNumber} ${s.farmer?.name ?? ''} ${s.customerName ?? ''}`,
        search,
      );
    });
  }, [data, search, range, status]);

  const { page, pager } = usePaged(filtered);

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
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Invoice number, farmer or customer name…"
          range={range}
          onRange={setRange}
          resultCount={filtered.length}
          totalCount={data.length}
        >
          <label className="field inline">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Part paid</option>
              <option value="PAID">Paid</option>
            </select>
          </label>
        </FilterBar>
      )}

      {data && data.length > 0 && filtered.length === 0 && (
        <EmptyState label="No sale matches those filters." />
      )}

      {data && filtered.length > 0 && (
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
              {page.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.farmer ? (
                      <button
                        className="link-cell"
                        onClick={() => setDetail({ id: s.farmerId!, kind: 'FARMER', name: s.farmer!.name })}
                        title={`Open ${s.farmer.name}`}
                      >
                        {s.farmer.name}
                      </button>
                    ) : (
                      // No account to open, so the name opens the invoice itself.
                      <button
                        className="link-cell walkin-tag"
                        onClick={() => setInvoiceFor(s.invoiceNumber)}
                        title={`Open ${s.invoiceNumber}`}
                      >
                        {s.customerName || 'Walk-in customer'}
                      </button>
                    )}
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
                    <button className="btn ghost small" onClick={() => setReturning(s.id)} title="Take goods back">
                      Return
                    </button>
                    <PrintInvoiceButton invoiceNumber={s.invoiceNumber} />
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

      {pager}

      {detail && <PartyDetail party={detail} onClose={() => setDetail(null)} />}

      {returning !== null && <SaleReturnModal saleId={returning} onClose={() => setReturning(null)} />}
      {invoiceFor && <InvoiceDetailModal invoiceNumber={invoiceFor} onClose={() => setInvoiceFor(null)} />}

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
  const [customerName, setCustomerName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIsoDate());
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState<LineItem[]>([{ productId: '', quantity: '', unitPrice: '', discount: '0' }]);
  const [payStatus, setPayStatus] = useState<PayStatus>('UNPAID');
  const [initialPaymentAmount, setInitialPaymentAmount] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  /** What one line comes to, after its own discount. */
  function lineTotal(it: LineItem): number {
    return Math.max(0, Number(it.quantity || 0) * Number(it.unitPrice || 0) - Number(it.discount || 0));
  }

  const subtotal = items.reduce((sum, it) => sum + lineTotal(it), 0);
  const total = Math.max(0, subtotal - Number(discount || 0));

  /**
   * How much of this product the shelf holds, less what earlier lines on this
   * same invoice have already claimed. Two lines of the same product were
   * each checked against the full stock figure, so 10 + 10 looked fine
   * against 15 until the server rejected the whole invoice.
   */
  function shortfallFor(index: number): { stock: number; wanted: number; short: number } | null {
    const it = items[index];
    if (it.productId === '') return null;
    const product = productById.get(Number(it.productId));
    if (!product || product.currentStock === undefined || product.currentStock === null) return null;
    const claimedEarlier = items
      .slice(0, index)
      .filter((other) => other.productId === it.productId)
      .reduce((sum, other) => sum + Number(other.quantity || 0), 0);
    const stock = Number(product.currentStock) - claimedEarlier;
    const wanted = Number(it.quantity || 0);
    return { stock, wanted, short: wanted - stock };
  }

  const overstocked = items
    .map((_, i) => ({ i, check: shortfallFor(i) }))
    .filter((row) => row.check && row.check.short > 0);

  // A walk-in has no khata, so an unpaid counter sale is a debt with no name
  // against it. The server refuses it; saying so here means the shopkeeper
  // finds out before they have typed the whole invoice.
  const walkInOnCredit = farmerId === '' && payStatus !== 'PAID';
  // Capped at the total so an over-typed amount can't create a negative balance.
  const paidNow =
    payStatus === 'PAID' ? total : payStatus === 'PARTIAL' ? Math.min(total, Number(initialPaymentAmount || 0)) : 0;

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function onProductPick(index: number, product: Product | null) {
    updateItem(index, { productId: product?.id ?? '', unitPrice: product?.sellingPrice ?? '' });
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.createSale({
        farmerId: farmerId || null,
        customerName: farmerId ? undefined : customerName.trim() || undefined,
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
          if (payStatus !== 'UNPAID' && !accountId) return setError('Choose which account the money goes into.');
          if (payStatus === 'PARTIAL' && paidNow <= 0) return setError('Enter how much is being paid now.');
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label>Customer</label>
            <FarmerPicker
              farmers={farmers ?? []}
              value={farmerId}
              onChange={(f) => setFarmerId(f?.id ?? '')}
            />
          </div>
          {!farmerId && (
            <div className="field">
              <label htmlFor="walkin-name">Walk-in name (optional)</label>
              <input
                id="walkin-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Leave blank for an anonymous counter sale"
              />
              <span className="hint">No credit account is created for a walk-in.</span>
            </div>
          )}
          <div className="field">
            <label>Invoice date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
          </div>
        </div>

        <h4 style={{ marginTop: 16 }}>Items</h4>
        {items.map((item, i) => {
          const check = shortfallFor(i);
          const product = item.productId === '' ? null : productById.get(Number(item.productId));
          return (
            <div
              key={i}
              className="form-grid line-row"
              style={{ marginBottom: 8, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto' }}
            >
              <div className="field">
                <label>Product</label>
                <ProductPicker
                  products={products ?? []}
                  value={item.productId}
                  onChange={(p) => onProductPick(i, p)}
                  required
                />
              </div>
              <div className="field">
                <label>Qty</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                  required
                />
                {/* The stock figure used to vanish the moment the product was
                    chosen, which is precisely when it matters. */}
                {check && (
                  <span className={`hint${check.short > 0 ? ' hint-danger' : ''}`}>
                    {check.short > 0
                      ? `only ${check.stock} ${product?.unit ?? ''} in stock`
                      : `${check.stock} ${product?.unit ?? ''} in stock`}
                  </span>
                )}
              </div>
              <div className="field">
                <label>Unit price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Discount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.discount}
                  onChange={(e) => updateItem(i, { discount: e.target.value })}
                />
              </div>
              {/* Read back to the customer without doing the sum in your head. */}
              <div className="field">
                <label>Amount</label>
                <output className="line-amount">{formatMoney(lineTotal(item))}</output>
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
          );
        })}
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
          partyLabel={farmerId ? 'Farmer pays' : 'Customer pays'}
        />

        {walkInOnCredit && (
          <div className="notice-danger" style={{ marginTop: 14 }}>
            <strong>A walk-in cannot take credit.</strong> There is no khata to record the balance
            on, so it would never appear in what you are owed. Take the full amount, or search the
            customer's name above and add them as a farmer.
          </div>
        )}

        {overstocked.length > 0 && (
          <div className="notice-danger" style={{ marginTop: 14 }}>
            <strong>Not enough stock.</strong>{' '}
            {overstocked
              .map((row) => {
                const product = productById.get(Number(items[row.i].productId));
                return `${product?.name ?? 'A line'} is ${row.check!.short} ${product?.unit ?? ''} short`;
              })
              .join('; ')}
            . Reduce the quantity, or record the purchase that brought it in first.
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn"
            disabled={mutation.isPending || walkInOnCredit || overstocked.length > 0}
          >
            {mutation.isPending ? 'Saving…' : 'Save sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
