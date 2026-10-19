import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, formatQty } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import { fileToResizedDataUrl } from '../lib/image';
import { IconPlus } from '../components/icons';
import { todayIsoDate } from '../lib/format';
import { DeleteButton } from '../components/DeleteButton';
import { EditButton } from '../components/EditButton';

type Filter = 'all' | 'lowStock' | 'outOfStock' | 'expiringSoon' | 'expired';

export function ProductsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState<number | null>(null);
  const qc = useQueryClient();

  const filters = {
    q: q || undefined,
    activeOnly: true,
    lowStock: filter === 'lowStock' ? true : undefined,
    outOfStock: filter === 'outOfStock' ? true : undefined,
    expiringSoon: filter === 'expiringSoon' ? true : undefined,
    expired: filter === 'expired' ? true : undefined,
  };
  const { data, isLoading, error } = useQuery({
    queryKey: ['products', filters],
    queryFn: () => api.listProducts(filters),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Products &amp; Stock</h1>
          <p className="subtitle">
            {isLoading
              ? 'Counting…'
              : `${data?.length ?? 0} ${(data?.length ?? 0) === 1 ? 'product' : 'products'}${
                  filter === 'all' ? ' in the catalogue' : ' match this filter'
                }`}
          </p>
        </div>
        <button className="btn" onClick={() => setShowCreate(true)}>
          <IconPlus size={15} />
          Add product
        </button>
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Search name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All active products</option>
          <option value="lowStock">Low stock</option>
          <option value="outOfStock">Out of stock</option>
          <option value="expiringSoon">Expiring soon</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load products." />}
      {data && data.length === 0 && <EmptyState label="No products match this filter." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-thumb"></th>
                <th>Product</th>
                <th>Code</th>
                <th>Unit</th>
                <th>Stock</th>
                <th>Selling Price</th>
                <th>Flags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="col-thumb">
                    <div className="thumb">
                      {p.imageData ? <img src={p.imageData} alt="" /> : <span aria-hidden="true">-</span>}
                    </div>
                  </td>
                  <td>{p.name}</td>
                  <td className="cell-muted">{p.sku}</td>
                  <td>{p.unit}</td>
                  <td>{formatQty(p.currentStock)}</td>
                  <td>{formatMoney(p.sellingPrice)}</td>
                  <td>
                    {p.isOutOfStock && <span className="badge unpaid">Out of stock</span>}{' '}
                    {!p.isOutOfStock && p.isLowStock && <span className="badge partial">Low</span>}{' '}
                    {p.hasExpired && <span className="badge unpaid">Expired</span>}{' '}
                    {p.hasExpiringSoon && <span className="badge partial">Expiring</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn secondary small" onClick={() => setAdjustProductId(p.id)}>
                        Adjust stock
                      </button>
                      <EditButton
                        title={p.name}
                        fields={[
                          { key: 'name', label: 'Name', required: true },
                          { key: 'unit', label: 'Unit', required: true },
                          { key: 'sellingPrice', label: 'Selling price', type: 'number', step: '0.01' },
                          { key: 'minStockThreshold', label: 'Minimum stock', type: 'number', step: '0.01' },
                        ]}
                        initial={{
                          name: p.name,
                          unit: p.unit,
                          sellingPrice: String(p.sellingPrice ?? ''),
                          minStockThreshold: String(p.minStockThreshold ?? ''),
                        }}
                        onSave={(v) =>
                          api.updateProduct(p.id, {
                            name: v.name,
                            unit: v.unit,
                            sellingPrice: Number(v.sellingPrice || 0),
                            minStockThreshold: Number(v.minStockThreshold || 0),
                          })
                        }
                        invalidate={['products']}
                      />
                      <DeleteButton
                        resource="products"
                        id={p.id}
                        label={p.name}
                        description="Only possible while it has never been bought or sold - otherwise mark it inactive instead."
                        invalidate={['products']}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateProductModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
      {adjustProductId && (
        <AdjustStockModal
          productId={adjustProductId}
          onClose={() => setAdjustProductId(null)}
          onDone={() => {
            setAdjustProductId(null);
            qc.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
    </div>
  );
}

function CreateProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    sku: '',
    name: '',
    unit: '',
    sellingPrice: '',
    minStockThreshold: '',
    openingStock: '',
    openingStockCost: '',
    openingStockBatchNumber: '',
    openingStockExpiryDate: '',
    preferredSupplierId: '',
  });
  const [imageData, setImageData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.listSuppliers() });
  const mutation = useMutation({
    mutationFn: () =>
      api.createProduct({
        sku: form.sku,
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice || 0),
        minStockThreshold: Number(form.minStockThreshold || 0),
        imageData,
        preferredSupplierId: form.preferredSupplierId ? Number(form.preferredSupplierId) : undefined,
        openingStock: form.openingStock ? Number(form.openingStock) : undefined,
        openingStockCost: form.openingStockCost ? Number(form.openingStockCost) : undefined,
        openingStockBatchNumber: form.openingStockBatchNumber || undefined,
        openingStockExpiryDate: form.openingStockExpiryDate || undefined,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create product'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Modal title="Add product" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>SKU / Code</label>
            <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Unit (bottle, kg, bag…)</label>
            <input required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div className="field">
            <label>Selling price</label>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.sellingPrice}
              onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Bought from</label>
            <select
              value={form.preferredSupplierId}
              onChange={(e) => setForm({ ...form, preferredSupplierId: e.target.value })}
            >
              <option value="">No usual supplier</option>
              {suppliers?.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.name}
                </option>
              ))}
            </select>
            <span className="hint">Who you normally order this from.</span>
          </div>
          <div className="field">
            <label>Minimum stock threshold</label>
            <input
              type="number"
              min="0"
              value={form.minStockThreshold}
              onChange={(e) => setForm({ ...form, minStockThreshold: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Opening stock (optional)</label>
            <input
              type="number"
              min="0"
              value={form.openingStock}
              onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Opening stock cost / unit</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.openingStockCost}
              onChange={(e) => setForm({ ...form, openingStockCost: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Batch number</label>
            <input
              value={form.openingStockBatchNumber}
              onChange={(e) => setForm({ ...form, openingStockBatchNumber: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Expiry date</label>
            <input
              type="date"
              min={todayIsoDate()}
              value={form.openingStockExpiryDate}
              onChange={(e) => setForm({ ...form, openingStockExpiryDate: e.target.value })}
            />
            <span className="hint">Applies to the opening stock batch.</span>
          </div>
        </div>

        <ImagePicker value={imageData} onChange={setImageData} onError={setError} />
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustStockModal({ productId, onClose, onDone }: { productId: number; onClose: () => void; onDone: () => void }) {
  const [quantityChange, setQuantityChange] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const qty = Number(quantityChange || 0);
  const adding = qty > 0;

  const mutation = useMutation({
    mutationFn: () =>
      api.adjustStock(productId, {
        quantityChange: qty,
        reason: reason || undefined,
        // Expiry only means something for stock coming in - it is a property
        // of the batch being added, not of a correction downward.
        expiryDate: adding && expiryDate ? expiryDate : undefined,
        batchNumber: adding && batchNumber ? batchNumber : undefined,
      }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not adjust stock'),
  });

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!qty) {
            setError('Enter how much stock to add or remove.');
            return;
          }
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <div className="field">
            <label htmlFor="adj-qty">Quantity change</label>
            <input
              id="adj-qty"
              required
              type="number"
              step="any"
              placeholder="e.g. 12 to add, -3 to remove"
              value={quantityChange}
              onChange={(e) => setQuantityChange(e.target.value)}
            />
            <span className="hint">Use a minus sign to reduce stock.</span>
          </div>

          {adding && (
            <>
              <div className="field">
                <label htmlFor="adj-expiry">Expiry date</label>
                <input
                  id="adj-expiry"
                  type="date"
                  min={todayIsoDate()}
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
                <span className="hint">Optional - starts a new batch for this stock.</span>
              </div>
              <div className="field">
                <label htmlFor="adj-batch">Batch number</label>
                <input id="adj-batch" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="adj-note">Note</label>
            <input
              id="adj-note"
              placeholder="e.g. counted the shelf"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="hint">Optional.</span>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Apply adjustment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImagePicker({
  value,
  onChange,
  onError,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await fileToResizedDataUrl(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not read that image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="image-picker">
      <div className="image-picker-preview" aria-hidden={!value}>
        {value ? <img src={value} alt="" /> : <span className="muted-3">No photo</span>}
      </div>
      <div className="image-picker-actions">
        <label className="btn secondary small" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Processing…' : value ? 'Replace photo' : 'Add photo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={busy}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {value && (
          <button type="button" className="btn ghost small" onClick={() => onChange(null)}>
            Remove
          </button>
        )}
        <span className="hint">Optional. Resized to 640px before saving.</span>
      </div>
    </div>
  );
}
