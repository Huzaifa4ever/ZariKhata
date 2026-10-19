import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as api from '../api/resources';
import { formatMoney, formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { TrendChart, BalanceDonut, TopProducts } from '../components/Charts';
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
          receivables={Number(data.totalFarmerReceivables)}
          payables={Number(data.totalSupplierPayables)}
          cash={Number(data.cashAndBank)}
        />
      </div>

      <div className="section-label">Position</div>
      <div className="stat-grid">
        <Stat label="Cash & Bank" value={formatMoney(data.cashAndBank)} icon={<IconAccounts size={13} />} />
        <Stat label="Stock Value" value={formatMoney(data.stockValue)} icon={<IconProducts size={13} />} />
        <Stat
          label="Farmer Receivables"
          value={formatMoney(data.totalFarmerReceivables)}
          icon={<IconFarmers size={13} />}
          hint="Owed to you"
        />
        <Stat
          label="Supplier Payables"
          value={formatMoney(data.totalSupplierPayables)}
          icon={<IconSuppliers size={13} />}
          hint="Owed by you"
        />
      </div>

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
