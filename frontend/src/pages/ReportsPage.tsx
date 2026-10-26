/**
 * Reports - deliberately kept to two questions: "which report?" and "which
 * period?". Everything else (column choices, company-vs-customer copies,
 * CSV eligibility) used to be exposed as toggles; it is now decided per report
 * so the shopkeeper never has to configure anything to get a usable page.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/resources';
import { getToken } from '../api/client';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { printReport, type PrintColumn } from '../components/PrintReport';
import { getBusiness } from '../lib/printBrand';
import { PartyDetail, type PartyRef, type PartyKind } from '../components/PartyDetail';
import { printInvoiceA4, printInvoiceReceipt } from '../components/PrintInvoice';
import { formatMoney, todayIsoDate, describeBalance } from '../lib/format';
import { IconFarmers, IconPrint, IconDownload, IconReports, IconSearch } from '../components/icons';

/* ───────────────────────── period presets ───────────────────────── */

function iso(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
}
function monthStart(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  return iso(d);
}
function monthEnd(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset + 1, 0);
  return iso(d);
}
function yearStart(offset = 0) {
  return `${new Date().getFullYear() + offset}-01-01`;
}
function yearEnd(offset = 0) {
  return `${new Date().getFullYear() + offset}-12-31`;
}

const PERIODS = [
  { id: 'this-month', label: 'This month', from: () => monthStart(), to: () => todayIsoDate() },
  { id: 'last-month', label: 'Last month', from: () => monthStart(-1), to: () => monthEnd(-1) },
  { id: 'this-year', label: 'This year', from: () => yearStart(), to: () => todayIsoDate() },
  { id: 'last-year', label: 'Last year', from: () => yearStart(-1), to: () => yearEnd(-1) },
  { id: 'custom', label: 'Custom…', from: () => monthStart(), to: () => todayIsoDate() },
] as const;

/* ───────────────────────── report catalogue ───────────────────────── */

/**
 * A report column, plus the one thing the printed version does not need: which
 * cells are names you can click through to the underlying record.
 */
type ReportColumn = PrintColumn & {
  /**
   * Marks this cell as a party name. `idKey` is the field on the row holding
   * that party's id - a row whose id is missing or null stays plain text,
   * which is what keeps walk-in customers unclickable.
   */
  party?: { kind: PartyKind; idKey: string };
};

interface ReportDef {
  key: string;
  label: string;
  blurb: string;
  group: string;
  columns: ReportColumn[];
  /** Reports whose numbers don't depend on a date range. */
  dateless?: boolean;
  csv?: boolean;
  summary?: (d: Record<string, unknown>) => Array<{ label: string; value: string; highlight?: boolean }>;
}

const MONEY = (key: string, label: string): ReportColumn => ({ key, label, money: true });

const REPORTS: ReportDef[] = [
  {
    key: 'sales', label: 'Sales', blurb: 'Every invoice raised in the period.', group: 'Trade', csv: true,
    columns: [
      { key: 'farmer', label: 'Farmer', party: { kind: 'FARMER', idKey: 'farmerId' } },
      { key: 'date', label: 'Date' },
      { key: 'invoiceNumber', label: 'Ref', muted: true }, MONEY('total', 'Total'),
      MONEY('amountPaid', 'Paid'), MONEY('balance', 'Balance'),
      { key: 'status', label: 'Status', align: 'center' },
    ],
    summary: (d) => [{ label: 'Invoices', value: String(d.count ?? 0) }],
  },
  {
    key: 'purchases', label: 'Purchases', blurb: 'Stock bought from companies and suppliers.', group: 'Trade', csv: true,
    columns: [
      { key: 'supplier', label: 'Supplier', party: { kind: 'SUPPLIER', idKey: 'supplierId' } },
      { key: 'date', label: 'Date' },
      { key: 'invoiceNumber', label: 'Ref', muted: true }, MONEY('total', 'Total'),
      MONEY('amountPaid', 'Paid'), MONEY('balance', 'Balance'),
      { key: 'status', label: 'Status', align: 'center' },
    ],
    summary: (d) => [{ label: 'Invoices', value: String(d.count ?? 0) }],
  },
  {
    key: 'expenses', label: 'Expenses', blurb: 'Rent, wages, transport and everything else.', group: 'Trade', csv: true,
    columns: [
      { key: 'date', label: 'Date' }, { key: 'category', label: 'Category' },
      { key: 'account', label: 'Paid from' }, MONEY('amount', 'Amount'),
      { key: 'description', label: 'Note' },
    ],
    summary: (d) => [{ label: 'Total expenses', value: `Rs ${d.total}`, highlight: true }],
  },
  {
    key: 'profit-loss', label: 'Profit & Loss', blurb: 'Revenue, cost of goods, expenses and what is left.',
    group: 'Trade', columns: [],
    summary: (d) => [
      { label: 'Revenue', value: `Rs ${d.revenue}` },
      { label: 'Cost of goods', value: `Rs ${d.cogs}` },
      { label: 'Gross profit', value: `Rs ${d.grossProfit}` },
      { label: 'Expenses', value: `Rs ${d.expenses}` },
      { label: 'Net profit', value: `Rs ${d.netProfit}`, highlight: true },
    ],
  },
  {
    key: 'farmer-receivables', label: 'Farmer Receivables', blurb: 'Who owes you, and how much.',
    group: 'Money', dateless: true, csv: true,
    columns: [
      { key: 'name', label: 'Farmer', party: { kind: 'FARMER', idKey: 'id' } },
      { key: 'phone', label: 'Phone' },
      MONEY('balance', 'Balance due'),
    ],
    summary: (d) => [{ label: 'Farmers owing', value: String(d.count ?? 0), highlight: true }],
  },
  {
    key: 'supplier-payables', label: 'Supplier Payables', blurb: 'Who you owe, and how much.',
    group: 'Money', dateless: true, csv: true,
    columns: [
      { key: 'name', label: 'Supplier', party: { kind: 'SUPPLIER', idKey: 'id' } },
      { key: 'phone', label: 'Phone' },
      MONEY('balance', 'Balance due'),
    ],
    summary: (d) => [{ label: 'Suppliers owed', value: String(d.count ?? 0), highlight: true }],
  },
  {
    key: 'stock', label: 'Stock on Hand', blurb: 'Current quantity of every active product.',
    group: 'Stock', dateless: true, csv: true,
    columns: [
      { key: 'name', label: 'Product' }, { key: 'sku', label: 'Code', muted: true },
      { key: 'unit', label: 'Unit', align: 'center' },
      { key: 'currentStock', label: 'Stock', align: 'right' }, MONEY('sellingPrice', 'Price'),
    ],
  },
  {
    key: 'low-stock', label: 'Low Stock', blurb: 'Items at or below their reorder threshold.',
    group: 'Stock', dateless: true, csv: true,
    columns: [
      { key: 'name', label: 'Product' }, { key: 'sku', label: 'Code', muted: true },
      { key: 'currentStock', label: 'In stock', align: 'right' },
      { key: 'minStockThreshold', label: 'Minimum', align: 'right' },
    ],
  },
  {
    key: 'expiry', label: 'Expiry Watch', blurb: 'Batches expired or expiring soon.',
    group: 'Stock', dateless: true,
    columns: [
      { key: 'name', label: 'Product' }, { key: 'sku', label: 'Code', muted: true },
      { key: 'currentStock', label: 'Stock', align: 'right' }, { key: 'state', label: 'Status' },
    ],
  },
  {
    key: 'stock-valuation', label: 'Stock Valuation', blurb: 'What the shelves are worth at cost.',
    group: 'Stock', dateless: true,
    columns: [
      { key: 'name', label: 'Product' }, { key: 'sku', label: 'Code', muted: true },
      { key: 'quantity', label: 'Qty', align: 'right' }, MONEY('value', 'Value'),
    ],
    summary: (d) => [{ label: 'Total stock value', value: `Rs ${d.totalValue ?? d.total ?? 0}`, highlight: true }],
  },
];

const GROUPS = ['Trade', 'Money', 'Stock'];

/* ───────────────────────── page ───────────────────────── */

type Mode = 'reports' | 'statement' | 'invoice';

export function ReportsPage() {
  const [mode, setMode] = useState<Mode>('reports');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="subtitle">Pick a report, pick a period, print it.</p>
        </div>
        <div className="segmented">
          <button className={mode === 'reports' ? 'active' : ''} onClick={() => setMode('reports')}>
            <IconReports size={15} /> Shop reports
          </button>
          <button className={mode === 'statement' ? 'active' : ''} onClick={() => setMode('statement')}>
            <IconFarmers size={15} /> Party statement
          </button>
          <button className={mode === 'invoice' ? 'active' : ''} onClick={() => setMode('invoice')}>
            <IconSearch size={15} /> Find invoice
          </button>
        </div>
      </div>

      {mode === 'reports' && <ShopReports />}
      {mode === 'statement' && <PartyStatementPicker />}
      {mode === 'invoice' && <InvoiceLookupPanel />}
    </div>
  );
}

/* ───────────────────────── period picker ───────────────────────── */

function usePeriod() {
  const [periodId, setPeriodId] = useState<string>('this-month');
  const preset = PERIODS.find((p) => p.id === periodId)!;
  const [customFrom, setCustomFrom] = useState(monthStart());
  const [customTo, setCustomTo] = useState(todayIsoDate());

  const from = periodId === 'custom' ? customFrom : preset.from();
  const to = periodId === 'custom' ? customTo : preset.to();

  const control = (
    <div className="period-bar">
      <div className="segmented small">
        {PERIODS.map((p) => (
          <button key={p.id} className={periodId === p.id ? 'active' : ''} onClick={() => setPeriodId(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {periodId === 'custom' && (
        <div className="row" style={{ gap: 6 }}>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="muted-3">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}
    </div>
  );

  return { from, to, control, label: preset.label };
}

/* ───────────────────────── shop reports ───────────────────────── */

function ShopReports() {
  const [selected, setSelected] = useState<string>('sales');
  const [party, setParty] = useState<PartyRef | null>(null);
  const def = REPORTS.find((r) => r.key === selected)!;
  const { from, to, control, label: periodLabel } = usePeriod();
  const [exporting, setExporting] = useState(false);

  const params = def.dateless ? {} : { from, to };
  const { data, isLoading, error } = useQuery({
    queryKey: ['report', selected, params],
    queryFn: () => api.getReport(selected, params),
  });

  const body = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(body.rows) ? (body.rows as Array<Record<string, unknown>>) : [];
  const summary = def.summary ? def.summary(body) : [];
  const rangeLabel = def.dateless ? 'As of today' : `${from} to ${to}`;

  function handlePrint() {
    printReport({
      title: def.label,
      subtitle: def.dateless ? undefined : periodLabel,
      dateRange: rangeLabel,
      business: getBusiness(),
      summary,
      sections: def.columns.length ? [{ heading: def.label, columns: def.columns, rows }] : [],
    });
  }

  async function handleCsv() {
    setExporting(true);
    try {
      const url = new URL(`/api/reports/${selected}`, import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000');
      url.searchParams.set('format', 'csv');
      if (!def.dateless) {
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
      }
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error();
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${selected}-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      alert('Could not export that report.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="reports-layout">
      <aside className="report-picker">
        {GROUPS.map((g) => (
          <div key={g}>
            <div className="sidebar-group-label">{g}</div>
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <button
                key={r.key}
                className={`report-item${selected === r.key ? ' active' : ''}`}
                onClick={() => setSelected(r.key)}
              >
                <span className="report-item-label">{r.label}</span>
                <span className="report-item-blurb">{r.blurb}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <section className="report-body">
        <div className="report-toolbar">
          {def.dateless ? <span className="muted-3">Current position - no date range needed.</span> : control}
          <div className="spacer" />
          {def.csv && (
            <button className="btn secondary small" onClick={handleCsv} disabled={exporting}>
              <IconDownload size={14} /> {exporting ? 'Exporting…' : 'CSV'}
            </button>
          )}
          <button className="btn small" onClick={handlePrint} disabled={isLoading || Boolean(error)}>
            <IconPrint size={14} /> Print A4
          </button>
        </div>

        {isLoading && <LoadingState />}
        {error && <ErrorBanner message="Could not load this report." />}

        {!isLoading && !error && (
          <>
            {summary.length > 0 && (
              <div className="stat-grid">
                {summary.map((s) => (
                  <div className={`stat-card${s.highlight ? ' accent' : ''}`} key={s.label}>
                    <div className="label">{s.label}</div>
                    <div className="value">{s.value}</div>
                  </div>
                ))}
              </div>
            )}
            {def.columns.length > 0 &&
              (rows.length === 0 ? (
                <EmptyState label="Nothing recorded for this period." />
              ) : (
                <ReportTable columns={def.columns} rows={rows} onOpenParty={setParty} />
              ))}
          </>
        )}
      </section>

      {party && <PartyDetail party={party} onClose={() => setParty(null)} />}
    </div>
  );
}

/* ───────────── party statement: farmers AND suppliers ───────────── */

/**
 * Supplier Payables used to be a list of balances with no way through to the
 * detail, and the only statement in the app was the farmer one. Both sides now
 * open the same full statement - invoices, line items, payments, running
 * balance - via the shared PartyDetail view.
 */
function PartyStatementPicker() {
  const [kind, setKind] = useState<PartyKind>('FARMER');
  const [open, setOpen] = useState<PartyRef | null>(null);

  const { data: farmers } = useQuery({ queryKey: ['farmers'], queryFn: () => api.listFarmers() });
  const { data: suppliers } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.listSuppliers() });

  const list = (kind === 'FARMER' ? farmers : suppliers) ?? [];

  return (
    <div>
      <div className="report-toolbar">
        <div className="segmented small">
          <button className={kind === 'FARMER' ? 'active' : ''} onClick={() => setKind('FARMER')}>Farmers</button>
          <button className={kind === 'SUPPLIER' ? 'active' : ''} onClick={() => setKind('SUPPLIER')}>Suppliers</button>
        </div>
        <span className="muted-3">Click a name for the full statement, then print it.</span>
      </div>

      {list.length === 0 ? (
        <EmptyState label={`No ${kind === 'FARMER' ? 'farmers' : 'suppliers'} yet.`} />
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{kind === 'FARMER' ? 'Farmer' : 'Supplier'}</th>
                <th>Phone</th>
                <th className="text-right">{kind === 'FARMER' ? 'Owes you' : 'You owe'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x: any) => (
                <tr key={x.id}>
                  <td>
                    <button className="link-cell" onClick={() => setOpen({ id: x.id, kind, name: x.name })}>
                      {x.name}
                    </button>
                  </td>
                  <td>{x.phone ?? '-'}</td>
                  <td className="text-right">
                    {describeBalance(x.outstandingBalance, kind === 'FARMER' ? 'receivable' : 'payable').text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <PartyDetail party={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ───────────────────────── invoice lookup ───────────────────────── */

/** Search any invoice number - sale or purchase - and see everything on it. */
function InvoiceLookupPanel() {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['invoice-lookup', query],
    queryFn: () => api.lookupInvoice(query),
    enabled: query.length > 0,
    retry: false,
  });

  return (
    <div>
      <form
        className="report-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(term.trim());
        }}
      >
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="inv-search">Invoice number</label>
          <input
            id="inv-search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. S-00003 or P-00001"
            autoFocus
          />
        </div>
        <button className="btn" type="submit" style={{ alignSelf: 'flex-end' }}>
          <IconSearch size={15} /> Find
        </button>
      </form>

      {!query && <EmptyState label="Enter a sale or purchase invoice number." />}
      {query && isLoading && <LoadingState />}
      {query && error && <ErrorBanner message={`No invoice found with number "${query}".`} />}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">{data.kind === 'SALE' ? 'Customer' : 'Supplier'}</div>
              <div className="value" style={{ fontSize: 16 }}>{data.party.name}</div>
              <div className="hint">{data.date}</div>
            </div>
            <div className="stat-card">
              <div className="label">Total</div>
              <div className="value">{formatMoney(data.total)}</div>
            </div>
            <div className="stat-card">
              <div className="label">Paid</div>
              <div className="value">{formatMoney(data.amountPaid)}</div>
            </div>
            <div className={`stat-card${Number(data.balance) > 0 ? ' danger' : ' accent'}`}>
              <div className="label">Balance</div>
              <div className="value">{formatMoney(data.balance)}</div>
              <div className="hint">{data.status}</div>
            </div>
          </div>

          <div className="report-toolbar">
            <div className="spacer" />
            <button className="btn secondary small" onClick={() => printInvoiceReceipt(data)}>
              <IconPrint size={14} /> Receipt
            </button>
            <button className="btn small" onClick={() => printInvoiceA4(data)}>
              <IconPrint size={14} /> Invoice (A4)
            </button>
          </div>

          <ReportTable
            heading="Items"
            columns={[
              { key: 'product', label: 'Product' },
              { key: 'sku', label: 'Code', muted: true },
              { key: 'quantity', label: 'Qty', align: 'right' },
              { key: 'unitPrice', label: data.kind === 'SALE' ? 'Price' : 'Cost', money: true },
              { key: 'discount', label: 'Discount', money: true },
              { key: 'lineTotal', label: 'Amount', money: true },
            ]}
            rows={data.lines}
          />

          {data.payments.length > 0 && (
            <ReportTable
              heading="Payments against this invoice"
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'amount', label: 'Amount', money: true },
                { key: 'method', label: 'Method' },
                { key: 'account', label: 'Account' },
              ]}
              rows={data.payments}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── table ───────────────────────── */

function ReportTable({
  columns,
  rows,
  heading,
  onOpenParty,
}: {
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  heading?: string;
  /** Omitted by callers that have nowhere to navigate to, e.g. the statement. */
  onOpenParty?: (party: PartyRef) => void;
}) {
  if (rows.length === 0) return <EmptyState label="Nothing to show." />;
  return (
    <>
      {heading && <div className="section-label">{heading}</div>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.money || c.align === 'right' ? 'text-right' : ''}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const raw = row[c.key];
                  const money = c.money && raw !== '' && raw != null;
                  const cls = [
                    c.money || c.align === 'right' ? 'text-right' : '',
                    c.muted ? 'cell-muted' : '',
                  ].filter(Boolean).join(' ');
                  const partyId = c.party ? row[c.party.idKey] : null;
                  if (c.party && onOpenParty && typeof partyId === 'number' && partyId > 0) {
                    return (
                      <td key={c.key} className={cls}>
                        <button
                          className="link-cell"
                          onClick={() => onOpenParty({ id: partyId, kind: c.party!.kind, name: String(raw) })}
                        >
                          {String(raw)}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} className={cls}>
                      {money ? formatMoney(raw as string) : raw == null || raw === '' ? '-' : String(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
