/**
 * Biller - a fast counter-side bill writer.
 *
 * Pick a customer (or leave it as a walk-in), add lines, print an A4 invoice.
 * The printed document shares its chrome with every other ZariKhata printout
 * (see lib/printBrand), so a bill and a statement look like they came from the
 * same shop.
 *
 * Intentionally lightweight: it does not post a Sale or move stock. That is the
 * Sales page's job, where the validation and ledger work lives.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/resources';
import { EmptyState } from '../components/StatusBits';
import { IconPlus, IconPrint, IconTrash } from '../components/icons';
import { formatMoney } from '../lib/format';
import {
  esc,
  getBusiness,
  openReceiptWindow,
  receiptHeaderHtml,
  rs,
  type PrintBusiness,
  type ReceiptWidth,
} from '../lib/printBrand';

interface LineItem {
  id: number;
  productName: string;
  qty: number;
  unitPrice: number;
}

let seq = 0;
const nextId = () => (seq += 1);

function todayDisplay(): string {
  return new Date().toLocaleDateString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function genInvoiceNo(): string {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(now).replace(/-/g, '');
  return `B-${ymd}-${String(Math.floor(Math.random() * 900 + 100))}`;
}

/* ───────────────────────── printing ───────────────────────── */

function printReceipt(opts: {
  invoiceNo: string;
  width: ReceiptWidth;
  business: PrintBusiness;
  customer: { name: string; phone?: string; village?: string } | null;
  items: LineItem[];
  discount: number;
  paid: number;
  note: string;
}) {
  const { invoiceNo, width, business, customer, items, discount, paid, note } = opts;

  const subTotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const total = Math.max(0, subTotal - discount);
  const due = Math.max(0, total - paid);

  // Each item is two lines: the name on its own, then qty x rate and the
  // amount. On a 58mm roll a five-column table is unreadable.
  const rows = items
    .map(
      (item) => `<tr>
        <td colspan="2"><div class="item-name">${esc(item.productName)}</div>
          <div class="small">${item.qty} x ${rs(item.unitPrice)}</div></td>
        <td class="r">${rs(item.qty * item.unitPrice)}</td>
      </tr>`,
    )
    .join('');

  const body = [
    receiptHeaderHtml(business),
    '<div class="rule"></div>',
    `<div class="small">
       <div><span class="b">Bill:</span> ${esc(invoiceNo)}</div>
       <div><span class="b">Date:</span> ${esc(todayDisplay())}</div>
       <div><span class="b">Customer:</span> ${esc(customer?.name ?? 'Walk-in')}</div>
       ${customer?.phone ? `<div><span class="b">Phone:</span> ${esc(customer.phone)}</div>` : ''}
     </div>`,
    '<div class="rule"></div>',
    `<table><thead><tr><th colspan="2">Item</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>`,
    '<div class="rule-solid"></div>',
    `<div class="tot"><span>Sub-total</span><span>${rs(subTotal)}</span></div>`,
    discount > 0 ? `<div class="tot"><span>Discount</span><span>- ${rs(discount)}</span></div>` : '',
    `<div class="rule-solid"></div>`,
    `<div class="tot grand"><span>TOTAL</span><span>Rs ${rs(total)}</span></div>`,
    paid > 0 ? `<div class="tot"><span>Paid</span><span>${rs(paid)}</span></div>` : '',
    paid > 0 ? `<div class="tot b"><span>Balance due</span><span>Rs ${rs(due)}</span></div>` : '',
    '<div class="rule"></div>',
    note ? `<div class="small c">${esc(note)}</div>` : '',
    `<div class="foot c">
       <div class="b">Thank you</div>
       <div class="small">Goods once sold are not returnable without a receipt.</div>
       <div class="small" style="margin-top:2mm">Powered by ZariKhata</div>
     </div>`,
  ].join('');

  openReceiptWindow(`Bill ${invoiceNo}`, width, body);
}

/* ───────────────────────── page ───────────────────────── */

export function BillerPage() {
  const [invoiceNo, setInvoiceNo] = useState(genInvoiceNo);
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const [items, setItems] = useState<LineItem[]>([{ id: nextId(), productName: '', qty: 1, unitPrice: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [note, setNote] = useState('');
  // Most counter printers here are 80mm; 58mm is the small handheld sort.
  const [paperWidth, setPaperWidth] = useState<ReceiptWidth>('80mm');

  const { data: farmers } = useQuery({ queryKey: ['farmers'], queryFn: () => api.listFarmers() });
  const { data: products } = useQuery({
    queryKey: ['products', { activeOnly: true }],
    queryFn: () => api.listProducts({ activeOnly: true }),
  });

  const customer = farmers?.find((f) => f.id === farmerId) ?? null;
  const filled = items.filter((i) => i.productName.trim());

  const { subTotal, total, due } = useMemo(() => {
    const sub = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const t = Math.max(0, sub - discount);
    return { subTotal: sub, total: t, due: Math.max(0, t - paid) };
  }, [items, discount, paid]);

  const update = (id: number, patch: Partial<LineItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  function pickProduct(id: number, productId: string) {
    const p = products?.find((x) => String(x.id) === productId);
    if (p) update(id, { productName: p.name, unitPrice: Number(p.sellingPrice ?? 0) });
  }

  function reset() {
    setItems([{ id: nextId(), productName: '', qty: 1, unitPrice: 0 }]);
    setDiscount(0);
    setPaid(0);
    setNote('');
    setFarmerId(null);
    setInvoiceNo(genInvoiceNo());
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Biller</h1>
          <p className="subtitle">Write a quick bill and print it on the counter receipt printer.</p>
        </div>
        <div className="btn-row">
          <div className="segmented small" title="Receipt paper width">
            {(['58mm', '80mm'] as ReceiptWidth[]).map((w) => (
              <button key={w} className={paperWidth === w ? 'active' : ''} onClick={() => setPaperWidth(w)}>
                {w}
              </button>
            ))}
          </div>
          <button className="btn secondary" onClick={reset}>
            New bill
          </button>
          <button
            className="btn"
            disabled={filled.length === 0}
            onClick={() =>
              printReceipt({
                invoiceNo,
                width: paperWidth,
                business: getBusiness(),
                customer: customer
                  ? { name: customer.name, phone: customer.phone ?? undefined, village: customer.village ?? undefined }
                  : null,
                items: filled,
                discount,
                paid,
                note,
              })
            }
          >
            <IconPrint size={15} />
            Print receipt
          </button>
        </div>
      </div>

      <div className="bill-head card">
        <div className="field">
          <label htmlFor="bill-customer">Customer</label>
          <select
            id="bill-customer"
            value={farmerId ?? ''}
            onChange={(e) => setFarmerId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Walk-in customer</option>
            {farmers?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.village ? ` - ${f.village}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="bill-meta">
          <div>
            <span className="k">Invoice</span>
            <span className="v mono">{invoiceNo}</span>
          </div>
          <div>
            <span className="k">Date</span>
            <span className="v">{todayDisplay()}</span>
          </div>
          {customer?.phone && (
            <div>
              <span className="k">Phone</span>
              <span className="v">{customer.phone}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data-table bill-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Item</th>
              <th style={{ width: 110 }} className="text-right">Qty</th>
              <th style={{ width: 140 }} className="text-right">Rate</th>
              <th style={{ width: 130 }} className="text-right">Amount</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id}>
                <td className="muted-3">{idx + 1}</td>
                <td>
                  <div className="bill-item-cell">
                    <select value="" onChange={(e) => pickProduct(item.id, e.target.value)} aria-label="Pick a product">
                      <option value="">From stock…</option>
                      {products?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Item description"
                      value={item.productName}
                      onChange={(e) => update(item.id, { productName: e.target.value })}
                    />
                  </div>
                </td>
                <td>
                  <input
                    className="cell-num"
                    type="number"
                    min={0}
                    step="any"
                    value={item.qty}
                    onChange={(e) => update(item.id, { qty: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    className="cell-num"
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => update(item.id, { unitPrice: Number(e.target.value) })}
                  />
                </td>
                <td className="text-right" style={{ fontWeight: 600 }}>
                  {formatMoney(item.qty * item.unitPrice)}
                </td>
                <td>
                  {items.length > 1 && (
                    <button
                      className="btn ghost small icon-only"
                      onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      aria-label={`Remove line ${idx + 1}`}
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
            className="btn ghost small"
            onClick={() => setItems((prev) => [...prev, { id: nextId(), productName: '', qty: 1, unitPrice: 0 }])}
          >
            <IconPlus size={15} />
            Add line
          </button>
        </div>
      </div>

      <div className="bill-footer">
        <div className="card">
          <div className="field">
            <label htmlFor="bill-note">Note on the bill (optional)</label>
            <input
              id="bill-note"
              placeholder="e.g. Payment due within 30 days"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {filled.length === 0 && (
            <EmptyState label="Add at least one item to print this receipt." />
          )}
        </div>

        <div className="card bill-totals">
          <div className="row">
            <span className="muted">Sub-total</span>
            <span className="num">{formatMoney(subTotal)}</span>
          </div>
          <div className="row">
            <span className="muted">Discount</span>
            <input
              className="cell-num"
              type="number"
              min={0}
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
            />
          </div>
          <div className="row grand">
            <span>Total</span>
            <span className="num">{formatMoney(total)}</span>
          </div>
          <div className="row">
            <span className="muted">Paid now</span>
            <input
              className="cell-num"
              type="number"
              min={0}
              step="0.01"
              value={paid}
              onChange={(e) => setPaid(Number(e.target.value))}
            />
          </div>
          <div className="row due">
            <span>Balance due</span>
            <span className="num">{formatMoney(due)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
