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
import { formatMoney, todayIsoDate } from '../lib/format';
import { IconFarmers, IconPrint, IconDownload, IconReports } from '../components/icons';

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

interface ReportDef {
  key: string;
  label: string;
  blurb: string;
  group: string;
  columns: PrintColumn[];
  /** Reports whose numbers don't depend on a date range. */
  dateless?: boolean;
  csv?: boolean;
  summary?: (d: Record<string, unknown>) => Array<{ label: string; value: string; highlight?: boolean }>;
}

const MONEY = (key: string, label: string): PrintColumn => ({ key, label, money: true });

const REPORTS: ReportDef[] = [
  {
    key: 'sales', label: 'Sales', blurb: 'Every invoice raised in the period.', group: 'Trade', csv: true,
    columns: [
      { key: 'farmer', label: 'Farmer' }, { key: 'date', label: 'Date' },
      { key: 'invoiceNumber', label: 'Ref', muted: true }, MONEY('total', 'Total'),
      MONEY('amountPaid', 'Paid'), MONEY('balance', 'Balance'),
      { key: 'status', label: 'Status', align: 'center' },
    ],
    summary: (d) => [{ label: 'Invoices', value: String(d.count ?? 0) }],
  },
  {
    key: 'purchases', label: 'Purchases', blurb: 'Stock bought from companies and suppliers.', group: 'Trade', csv: true,
    columns: [
      { key: 'supplier', label: 'Supplier' }, { key: 'date', label: 'Date' },
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
    columns: [{ key: 'name', label: 'Farmer' }, { key: 'phone', label: 'Phone' }, MONEY('balance', 'Balance due')],
    summary: (d) => [{ label: 'Farmers owing', value: String(d.count ?? 0), highlight: true }],
  },
  {
    key: 'supplier-payables', label: 'Supplier Payables', blurb: 'Who you owe, and how much.',
    group: 'Money', dateless: true, csv: true,
    columns: [{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, MONEY('balance', 'Balance due')],
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

type Mode = 'reports' | 'farmer';

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
          <button className={mode === 'farmer' ? 'active' : ''} onClick={() => setMode('farmer')}>
            <IconFarmers size={15} /> Farmer statement
          </button>
        </div>
      </div>

      {mode === 'reports' ? <ShopReports /> : <FarmerStatement />}
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
                <ReportTable columns={def.columns} rows={rows} />
              ))}
          </>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────── farmer statement ───────────────────────── */

function FarmerStatement() {
  const [farmerId, setFarmerId] = useState<number | null>(null);
  const { from, to, control, label: periodLabel } = usePeriod();

  const [loadingAll, setLoadingAll] = useState(false);
  const { data: farmers } = useQuery({ queryKey: ['farmers'], queryFn: () => api.listFarmers() });
  const { data, isLoading, error } = useQuery({
    queryKey: ['farmer-statement', farmerId, from, to],
    queryFn: () => api.getFarmerStatement(farmerId!, { from, to }),
    enabled: farmerId !== null,
  });

  /**
   * The whole account, ignoring whatever period is selected. This is the one
   * an owner actually hands a farmer when they come to settle up - "everything
   * you have ever owed me" - so it must not quietly depend on the date pills.
   */
  async function printEverything() {
    if (!farmerId) return;
    setLoadingAll(true);
    try {
      const all = await api.getFarmerStatement(farmerId, { from: '2000-01-01', to: '2099-12-31' });
      renderStatement(all, 'Complete history', 'All time');
    } catch {
      alert('Could not load the full history.');
    } finally {
      setLoadingAll(false);
    }
  }

  function handlePrint() {
    if (!data) return;
    renderStatement(data, periodLabel, `${from} to ${to}`);
  }

  function renderStatement(data: api.FarmerStatement, subtitle: string, rangeLabel: string) {
    const f = data.farmer;
    printReport({
      title: 'Account Statement',
      subtitle,
      dateRange: rangeLabel,
      business: getBusiness(),
      party: {
        label: 'Statement for',
        name: f.name,
        phone: f.phone ?? undefined,
        village: f.village ?? undefined,
      },
      summary: [
        { label: 'Opening balance', value: `Rs ${data.summary.openingBalance}` },
        { label: 'Charged', value: `Rs ${data.summary.charged}` },
        { label: 'Paid', value: `Rs ${data.summary.paid}` },
        { label: 'Closing balance', value: `Rs ${data.summary.closingBalance}`, highlight: true },
      ],
      sections: [
        {
          heading: 'Running account',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'description', label: 'Details' },
            { key: 'debit', label: 'Charged', money: true },
            { key: 'credit', label: 'Paid', money: true },
            { key: 'balance', label: 'Balance', money: true },
          ],
          rows: data.entries.map((e) => ({ ...e, date: e.date.slice(0, 10) })),
          emptyLabel: 'No account movement in this period.',
        },
        {
          heading: 'Invoices',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'invoiceNumber', label: 'Ref', muted: true },
            { key: 'items', label: 'Items', align: 'center' },
            { key: 'total', label: 'Total', money: true },
            { key: 'amountPaid', label: 'Paid', money: true },
            { key: 'balance', label: 'Balance', money: true },
            { key: 'status', label: 'Status', align: 'center' },
          ],
          rows: data.sales,
          emptyLabel: 'No invoices in this period.',
        },
        {
          heading: 'Payments received',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'amount', label: 'Amount', money: true },
            { key: 'method', label: 'Method' },
            { key: 'account', label: 'Into' },
            { key: 'notes', label: 'Note' },
          ],
          rows: data.payments,
          emptyLabel: 'No payments in this period.',
        },
      ],
      note: `Closing balance of Rs ${data.summary.closingBalance} is payable to ${
        getBusiness().name || 'the shop'
      }. Please contact us if anything on this statement looks wrong.`,
      signatures: true,
    });
  }

  return (
    <div>
      <div className="card statement-bar">
        <div className="field">
          <label htmlFor="stmt-farmer">Farmer</label>
          <select
            id="stmt-farmer"
            value={farmerId ?? ''}
            onChange={(e) => setFarmerId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Choose a farmer…</option>
            {farmers?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.village ? ` - ${f.village}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Period</label>
          {control}
        </div>

        <div className="statement-actions">
          <button className="btn secondary" onClick={handlePrint} disabled={!data}>
            <IconPrint size={15} /> Print this period
          </button>
          <button className="btn" onClick={printEverything} disabled={!farmerId || loadingAll}>
            <IconPrint size={15} />
            {loadingAll ? 'Preparing…' : 'Print full history'}
          </button>
        </div>
      </div>

      {!farmerId && <EmptyState label="Choose a farmer to see their full account - invoices, payments and running balance." />}
      {farmerId && isLoading && <LoadingState />}
      {farmerId && error && <ErrorBanner message="Could not load this statement." />}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">Opening balance</div>
              <div className="value">{formatMoney(data.summary.openingBalance)}</div>
            </div>
            <div className="stat-card">
              <div className="label">Charged</div>
              <div className="value">{formatMoney(data.summary.charged)}</div>
              <div className="hint">{data.summary.invoiceCount} invoice(s)</div>
            </div>
            <div className="stat-card">
              <div className="label">Paid</div>
              <div className="value">{formatMoney(data.summary.paid)}</div>
              <div className="hint">{data.summary.paymentCount} payment(s)</div>
            </div>
            <div className="stat-card accent">
              <div className="label">Closing balance</div>
              <div className="value">{formatMoney(data.summary.closingBalance)}</div>
              <div className="hint">Owed to you</div>
            </div>
          </div>

          <ReportTable
            heading="Running account"
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'description', label: 'Details' },
              { key: 'debit', label: 'Charged', money: true },
              { key: 'credit', label: 'Paid', money: true },
              { key: 'balance', label: 'Balance', money: true },
            ]}
            rows={data.entries.map((e) => ({ ...e, date: e.date.slice(0, 10) }))}
          />
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
}: {
  columns: PrintColumn[];
  rows: Array<Record<string, unknown>>;
  heading?: string;
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
