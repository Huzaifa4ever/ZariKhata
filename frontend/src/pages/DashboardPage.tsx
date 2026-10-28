import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import * as api from '../api/resources';
import { formatDate, todayIsoDate } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { TrendChart, TopProducts } from '../components/Charts';
import type { PendingArrival } from '../api/types';
import { PartyDetail, type PartyRef } from '../components/PartyDetail';
import {
  Band,
  Rubric,
  Money,
  Sparkline,
  MonthAccount,
  AgingStrip,
  RankedBars,
  ReorderBullets,
  SolvencyRule,
} from '../components/Ledger';
import { IconTasks } from '../components/icons';

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
  const [party, setParty] = useState<PartyRef | null>(null);

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

  // Invoice-level balances, so receivables can be aged. The dashboard payload
  // only carries party totals, and "Rs 40,000 owed" means something very
  // different at 10 days than at 100.
  const { data: outstanding } = useQuery({
    queryKey: ['report', 'outstanding'],
    queryFn: () => api.getReport('outstanding'),
    staleTime: 0,
  });

  const aging = useMemo(() => {
    const sales = ((outstanding as { sales?: Array<{ invoiceDate: string; balance: string }> })?.sales) ?? [];
    const buckets = [
      { label: 'Under 30 days', amount: 0 },
      { label: '30 to 60', amount: 0 },
      { label: '60 to 90', amount: 0 },
      { label: 'Over 90 days', amount: 0 },
    ];
    const now = Date.now();
    for (const s of sales) {
      const days = Math.floor((now - new Date(s.invoiceDate).getTime()) / 86_400_000);
      const i = days < 30 ? 0 : days < 60 ? 1 : days < 90 ? 2 : 3;
      buckets[i].amount += Number(s.balance);
    }
    return buckets;
  }, [outstanding]);

  if (isLoading) return <LoadingState label="Loading dashboard…" />;
  if (error) return <ErrorBanner message="Could not load the dashboard." />;
  if (!data) return null;

  const f = data.finance;
  const salesSeries = data.salesTrend.map((d) => Number(d.sales));
  const expenseSeries = data.salesTrend.map((d) => Number(d.expenses));

  const monthRows = [
    { label: 'Revenue', value: Number(data.month.revenue), kind: 'total' as const },
    { label: 'Cost of goods sold', value: -Number(data.month.cogs), kind: 'cost' as const },
    { label: 'Running costs', value: -Number(data.month.expenses), kind: 'cost' as const },
    { label: 'Net profit', value: Number(data.month.netProfit), kind: 'result' as const },
  ];

  const lowStock = (data.lowStockProducts ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    stock: Number(p.currentStock ?? 0),
    threshold: Number(p.minStockThreshold ?? 0),
    unit: p.unit,
  }));

  return (
    <div className="page-ledger">
      {/* ---- 0. dateline ---- */}
      <Band className="dateline-band">
        <div className="dateline">
          <h1>The Day Book</h1>
          <span>{formatDate(todayIsoDate())}</span>
        </div>
      </Band>

      {/* ---- 1. the standing: the one saturated field on the page ---- */}
      <Band>
        <div className="standing">
          <div className="standing-head">
            <span>The standing</span>
            <span>as at {formatDate(todayIsoDate())}</span>
          </div>
          <div className="standing-figures">
            <div className="standing-figure lead">
              <span className="label">Cash &amp; bank</span>
              <span className="value"><Money value={data.cashAndBank} /></span>
              <span className="sub">what you can spend today</span>
            </div>
            <div className="standing-figure">
              <span className="label">On the shelves</span>
              <span className="value"><Money value={data.stockValue} /></span>
              <span className="sub">stock at cost</span>
            </div>
            <div className="standing-figure">
              <span className="label">Net position</span>
              <span className="value"><Money value={f.netPosition} /></span>
              <span className="sub">held, plus owed to you, less owed</span>
            </div>
          </div>
          <SolvencyRule receivable={Number(f.receivables.total)} payable={Number(f.payables.total)} />
        </div>
      </Band>

      {/* ---- 2. today, against fourteen ordinary days ---- */}
      <Band>
        <Rubric seq="Schedule I" title="Today" note="Each figure against the last fourteen days." />
        <div className="figures">
          <div className="figure">
            <span className="label">Sales</span>
            <span className="value"><Money value={data.today.sales} /></span>
            <Sparkline values={salesSeries} />
          </div>
          <div className="figure">
            <span className="label">Collected</span>
            <span className="value"><Money value={data.today.collections} /></span>
          </div>
          <div className="figure">
            <span className="label">Purchases</span>
            <span className="value"><Money value={data.today.purchases} /></span>
          </div>
          <div className="figure">
            <span className="label">Expenses</span>
            <span className="value"><Money value={data.today.expenses} /></span>
            <Sparkline values={expenseSeries} />
          </div>
        </div>
      </Band>

      {/* ---- 3. the month argued as a statement ---- */}
      <Band>
        <Rubric
          seq="Schedule II"
          title="The month's account"
          note="What came in, what it cost, and what is actually left."
        />
        <MonthAccount rows={monthRows} />
      </Band>

      {/* ---- 4 & 5. the two sides of the khata ---- */}
      <Band>
        <div className="band-split">
          <div>
            <Rubric seq="Schedule III" title="Who owes you money" />
            {aging.some((b) => b.amount > 0) && <AgingStrip buckets={aging} />}
            <RankedBars
              rows={f.receivables.parties}
              tone="green"
              onPick={(r) => setParty({ id: r.id, kind: 'FARMER', name: r.name })}
              empty="No farmer owes you anything today."
            />
          </div>
          <div>
            <Rubric seq="Schedule IV" title="Who you owe" />
            <RankedBars
              rows={f.payables.parties}
              tone="ink"
              onPick={(r) => setParty({ id: r.id, kind: 'SUPPLIER', name: r.name })}
              empty="You are square with every supplier."
            />
          </div>
        </div>
      </Band>

      {/* ---- 6. calls on your attention ---- */}
      <Band>
        <Rubric
          seq="Schedule V"
          title="Calls on your attention"
          note="Lines at or below their reorder level, and what has expired."
        />
        <div className="band-split">
          <ReorderBullets rows={lowStock} />
          <div className="attention-notes">
            {data.expiredCount > 0 && (
              <p className="attention-line danger">
                <strong>{data.expiredCount}</strong> batch(es) expired - pull them off the shelf.
              </p>
            )}
            {data.expiringSoonCount > 0 && (
              <p className="attention-line warn">
                <strong>{data.expiringSoonCount}</strong> batch(es) expiring soon.
              </p>
            )}
            {data.outOfStockCount > 0 && (
              <p className="attention-line danger">
                <strong>{data.outOfStockCount}</strong> product(s) out of stock.
              </p>
            )}
            {data.pendingArrivalCount > 0 && (
              <p className="attention-line">
                <strong>{data.pendingArrivalCount}</strong> order(s) still to arrive.
              </p>
            )}
            {data.expiredCount === 0 &&
              data.expiringSoonCount === 0 &&
              data.outOfStockCount === 0 &&
              data.pendingArrivalCount === 0 && (
                <p className="ledger-empty">Nothing on the shelves needs you today.</p>
              )}
          </div>
        </div>
      </Band>

      {/* ---- 7. the season ---- */}
      <Band>
        <Rubric seq="Schedule VI" title="The season" note={trend.subtitle} />
        <TrendChart data={trend.points} bucket={trend.bucket} title="" subtitle="" control={trend.control} />
      </Band>

      {/* ---- 8. the rest of the book ---- */}
      <Band>
        <div className="band-split">
          <div>
            <Rubric seq="Schedule VII" title="Top sellers" note="By value, this month." />
            <TopProducts items={data.topProducts ?? []} />
          </div>
          <div>
            <Rubric seq="Schedule VIII" title="Pending tasks" />
            {data.pendingTasks.length === 0 ? (
              <p className="ledger-empty">No pending tasks.</p>
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
            <Link to="/tasks" className="btn secondary small" style={{ marginTop: 'var(--s-3)' }}>
              <IconTasks size={14} />
              View all tasks
            </Link>
          </div>
        </div>
      </Band>

      {data.pendingArrivals.length > 0 && (
        <Band>
          <Rubric seq="Schedule IX" title="Waiting to arrive" note="Ordered and paid for, perhaps - but not on the shelf, so not in stock value." />
          <PendingArrivals rows={data.pendingArrivals} />
        </Band>
      )}

      {party && <PartyDetail party={party} onClose={() => setParty(null)} />}
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
                <td className="text-right"><Money value={r.total} /></td>
                <td className="text-right"><Money value={r.balance} /></td>
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
