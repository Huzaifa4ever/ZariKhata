import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { TrendChart, BalanceDonut, TopProducts } from '../components/Charts';
import type { FinanceSummary, PendingArrival } from '../api/types';
import {
  IconAccounts,
  IconAlert,
  IconExpenses,
  IconFarmers,
  IconProducts,
  IconPurchases,
  IconReceive,
  IconReports,
  IconSales,
  IconSuppliers,
  IconTasks,
} from '../components/icons';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const kToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const pad = (n: number) => String(n).padStart(2, '0');
/** Last calendar day of a month, via the day-0-of-next-month trick. */
const lastDayOf = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();

/**
 * Chart period: one calendar month, a whole year, or hand-picked dates.
 * Months are the unit a shopkeeper closes their books in, so they are the
 * default rather than a rolling "last N days" window.
 */
function useTrend() {
  const today = kToday();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  // 0 is a sentinel for "the whole year"; 1-12 are real months.
  const [month, setMonth] = useState<number>(Number(today.slice(5, 7)));
  const [custom, setCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 7)}-01`);
  const [customTo, setCustomTo] = useState(today);

  const from = custom ? customFrom : month === 0 ? `${year}-01-01` : `${year}-${pad(month)}-01`;
  const to = custom
    ? customTo
    : month === 0
      ? `${year}-12-31`
      : `${year}-${pad(month)}-${pad(lastDayOf(year, month))}`;

  const { data } = useQuery({
    queryKey: ['dashboard-trend', from, to],
    queryFn: () => api.getDashboardTrend({ from, to }),
    staleTime: 0,
  });

  // A few years back is enough for a shop; the list stays short and scannable.
  const thisYear = Number(today.slice(0, 4));
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];

  const control = (
    <div className="chart-range">
      <select
        value={custom ? 'custom' : String(month)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') {
            setCustom(true);
          } else {
            setCustom(false);
            setMonth(Number(v));
          }
        }}
        aria-label="Chart month"
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
        <option value="0">Whole year</option>
        <option value="custom">Custom dates…</option>
      </select>

      {!custom && (
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Chart year">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}

      {custom && (
        <>
          <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
          <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
        </>
      )}
    </div>
  );

  const subtitle = useMemo(() => {
    if (!data) return 'Loading…';
    if (custom) return `${from} to ${to}`;
    if (month === 0) return `${year} - every month`;
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }, [data, custom, from, to, month, year]);

  return { points: data?.points ?? [], bucket: data?.bucket ?? 'day', control, subtitle };
}

export function DashboardPage() {
  const trend = useTrend();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
    refetchInterval: 60_000,
    // The dashboard aggregates almost every table in the app, so any page can
    // invalidate it. Rather than depending on each one remembering to, treat it
    // as always stale: coming back to this screen refetches, full stop.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (error) return <ErrorBanner message="Could not load the dashboard." />;
  if (!data) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">Where the shop stands right now.</p>
        </div>
      </div>

      <div className="section-label">Today</div>
      <div className="stat-grid">
        <Stat label="Sales" value={formatMoney(data.today.sales)} icon={<IconSales size={13} />} />
        <Stat label="Collections" value={formatMoney(data.today.collections)} icon={<IconReceive size={13} />} />
        <Stat label="Purchases" value={formatMoney(data.today.purchases)} icon={<IconPurchases size={13} />} />
        <Stat label="Expenses" value={formatMoney(data.today.expenses)} icon={<IconExpenses size={13} />} />
      </div>

      <div className="chart-grid">
        <TrendChart
          data={trend.points}
          bucket={trend.bucket}
          subtitle={trend.subtitle}
          control={trend.control}
        />
        <BalanceDonut
          /* Same per-party figures the Debit & Credit panel shows, so the two
             halves of the dashboard cannot disagree with each other. */
          receivables={Number(data.finance.receivables.total)}
          payables={Number(data.finance.payables.total)}
          cash={Number(data.cashAndBank)}
        />
      </div>

      <div className="section-label">Position</div>
      <div className="stat-grid">
        <Stat label="Cash & Bank" value={formatMoney(data.cashAndBank)} icon={<IconAccounts size={13} />} />
        <Stat label="Stock Value" value={formatMoney(data.stockValue)} icon={<IconProducts size={13} />} />
        <Stat
          label="Receivables"
          value={formatMoney(data.finance.receivables.total)}
          icon={<IconFarmers size={13} />}
          hint={`${data.finance.receivables.count} farmer(s) owe you`}
        />
        <Stat
          label="Payables"
          value={formatMoney(data.finance.payables.total)}
          icon={<IconSuppliers size={13} />}
          tone={Number(data.finance.payables.total) > 0 ? 'warn' : undefined}
          hint={`${data.finance.payables.count} supplier(s) to pay`}
        />
      </div>

      <FinancePanel finance={data.finance} />

      {data.pendingArrivals.length > 0 && <PendingArrivals rows={data.pendingArrivals} />}

      <div className="section-label">This month</div>
      <div className="stat-grid">
        <Stat label="Sales" value={formatMoney(data.month.sales)} icon={<IconSales size={13} />} />
        <Stat label="Gross Profit" value={formatMoney(data.month.grossProfit)} icon={<IconReports size={13} />} />
        <Stat label="Net Profit" value={formatMoney(data.month.netProfit)} icon={<IconReports size={13} />} />
        <Stat label="Expenses" value={formatMoney(data.month.expenses)} icon={<IconExpenses size={13} />} />
      </div>

      <div className="chart-grid narrow">
        <TopProducts items={data.topProducts ?? []} />
        <div className="card">
          <h3>Pending tasks</h3>
          {data.pendingTasks.length === 0 ? (
            <EmptyState label="No pending tasks." />
          ) : (
            <ul className="list-plain">
              {data.pendingTasks.map((t) => (
                <li key={t.id}>
                  {t.title}
                  {t.dueDate ? <span className="muted-3"> - due {formatDate(t.dueDate)}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 14 }}>
            <Link to="/tasks" className="btn secondary small">
              <IconTasks size={14} />
              View all tasks
            </Link>
          </div>
        </div>
      </div>

      <div className="section-label">Needs attention</div>
      <div className="stat-grid">
        <Stat
          label="Low Stock"
          value={String(data.lowStockCount)}
          icon={<IconProducts size={13} />}
          tone={data.lowStockCount > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Out of Stock"
          value={String(data.outOfStockCount)}
          icon={<IconAlert size={13} />}
          tone={data.outOfStockCount > 0 ? 'danger' : undefined}
        />
        <Stat
          label="Expiring Soon"
          value={String(data.expiringSoonCount)}
          icon={<IconAlert size={13} />}
          tone={data.expiringSoonCount > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Expired"
          value={String(data.expiredCount)}
          icon={<IconAlert size={13} />}
          tone={data.expiredCount > 0 ? 'danger' : undefined}
        />
      </div>

      <div className="section-label">Overdue</div>
      <div>
        <div className="card">
          {data.overdueSales.length === 0 && data.overduePurchases.length === 0 ? (
            <EmptyState label="Nothing overdue - everything is on time." />
          ) : (
            <ul className="list-plain">
              {data.overdueSales.map((s) => (
                <li key={`s${s.id}`}>
                  <strong>{s.invoiceNumber}</strong> · {s.farmer?.name} -{' '}
                  <span className="num">{formatMoney(s.balance)}</span> due {formatDate(s.dueDate)}
                </li>
              ))}
              {data.overduePurchases.map((p) => (
                <li key={`p${p.id}`}>
                  <strong>{p.invoiceNumber}</strong> · {p.supplier?.name} -{' '}
                  <span className="num">{formatMoney(p.balance)}</span> due {formatDate(p.dueDate)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'danger';
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <div className={`stat-card${tone ? ` ${tone}` : ''}`}>
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/**
 * Debit and credit, in both senses, side by side.
 *
 * "Debit" means two different things in a shop and conflating them is how
 * dashboards end up lying: on a farmer's account a debit is a sale that raised
 * what they owe, while on the cash box a debit is money going out. Both are
 * shown, each labelled with what it actually means here.
 */
function FinancePanel({ finance }: { finance: FinanceSummary }) {
  return (
    <>
      <div className="section-label">Debit &amp; Credit</div>
      <div className="stat-grid">
        <Stat
          label="Total Debit"
          value={formatMoney(finance.ledger.totalDebit)}
          icon={<IconReports size={13} />}
          hint="Raised on farmer & supplier accounts"
        />
        <Stat
          label="Total Credit"
          value={formatMoney(finance.ledger.totalCredit)}
          icon={<IconReports size={13} />}
          hint="Settled on those accounts"
        />
        <Stat
          label="Money In"
          value={formatMoney(finance.money.in)}
          icon={<IconReceive size={13} />}
          hint="Into cash & bank, all time"
        />
        <Stat
          label="Money Out"
          value={formatMoney(finance.money.out)}
          icon={<IconExpenses size={13} />}
          hint="Out of cash & bank, all time"
        />
      </div>

      <div className="chart-grid narrow">
        <div className="card">
          <h3>Who owes what</h3>
          <div className="ledger-split">
            <PartyColumn
              title="Farmers owe you"
              total={finance.receivables.total}
              rows={finance.receivables.parties}
              extra={
                Number(finance.receivables.advances) > 0
                  ? `${formatMoney(finance.receivables.advances)} sitting as farmer credit`
                  : undefined
              }
              to="/farmers"
            />
            <PartyColumn
              title="You owe suppliers"
              total={finance.payables.total}
              rows={finance.payables.parties}
              extra={
                Number(finance.payables.advances) > 0
                  ? `${formatMoney(finance.payables.advances)} paid in advance`
                  : undefined
              }
              to="/suppliers"
            />
          </div>
          <p className="muted-3" style={{ fontSize: 12, marginBottom: 0 }}>
            Each party is counted on its own, so one farmer in credit never hides another's debt.
          </p>
        </div>

        <div className="card">
          <h3>Company accounts</h3>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">In</th>
                  <th className="text-right">Out</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {finance.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      <div className="cell-muted" style={{ fontSize: 11 }}>{a.type === 'BANK' ? 'Bank' : 'Cash'}</div>
                    </td>
                    <td className="text-right">{formatMoney(a.moneyIn)}</td>
                    <td className="text-right">{formatMoney(a.moneyOut)}</td>
                    <td className="text-right" style={{ fontWeight: 600 }}>{formatMoney(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-between" style={{ marginTop: 10, fontWeight: 600 }}>
            <span>Net position</span>
            <span>{formatMoney(finance.netPosition)}</span>
          </div>
          <p className="muted-3" style={{ fontSize: 12, marginBottom: 0 }}>
            What you hold, plus what is owed to you, less what you owe.
          </p>
        </div>
      </div>
    </>
  );
}

function PartyColumn({
  title,
  total,
  rows,
  extra,
  to,
}: {
  title: string;
  total: string;
  rows: Array<{ id: number; name: string; amount: string }>;
  extra?: string;
  to: string;
}) {
  return (
    <div>
      <div className="row-between" style={{ fontWeight: 600, marginBottom: 6 }}>
        <span>{title}</span>
        <span>{formatMoney(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted-3" style={{ fontSize: 12.5 }}>Nothing outstanding.</p>
      ) : (
        <ul className="list-plain">
          {rows.map((r) => (
            <li key={r.id} className="row-between">
              <span>{r.name}</span>
              <span className="num">{formatMoney(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {extra && <p className="muted-3" style={{ fontSize: 12 }}>{extra}</p>}
      <Link to={to} className="btn secondary small" style={{ marginTop: 6 }}>
        Open
      </Link>
    </div>
  );
}

/** Ordered and paid for, perhaps, but not on the shelf - so not in stock value. */
function PendingArrivals({ rows }: { rows: PendingArrival[] }) {
  return (
    <>
      <div className="section-label">Waiting to arrive</div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Ref</th>
              <th>Ordered</th>
              <th>Expected</th>
              <th className="text-right">Value</th>
              <th className="text-right">Still to pay</th>
              <th>Arrival</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.supplier}</td>
                <td className="cell-muted">{r.invoiceNumber}</td>
                <td className="cell-muted">{formatDate(r.invoiceDate)}</td>
                <td className="cell-muted">{r.expectedArrivalDate ? formatDate(r.expectedArrivalDate) : 'not given'}</td>
                <td className="text-right">{formatMoney(r.total)}</td>
                <td className="text-right">{formatMoney(r.balance)}</td>
                <td>
                  <span className={`badge ${r.arrivalStatus === 'PARTIAL' ? 'partial' : 'unpaid'}`}>
                    {r.arrivalStatus === 'PARTIAL' ? 'Part arrived' : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted-3" style={{ fontSize: 12, marginTop: 8 }}>
        These are not counted in stock on hand or stock value - confirm arrival on the Purchases page.
      </p>
    </>
  );
}
