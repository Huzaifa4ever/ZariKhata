/**
 * Charts drawn as plain inline SVG.
 *
 * No charting library on purpose: this app ships offline inside Electron, the
 * whole bundle has to stay small, and these three shapes are the only ones the
 * dashboard needs. They read from the same CSS custom properties as the rest
 * of the UI, so they re-theme with light/dark for free.
 */
import { type ReactNode } from 'react';
import { formatMoney } from '../lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19/10" for a day bucket, "Oct" (or "Oct 25" across a year boundary) for a month. */
function shortDate(iso: string, bucket: 'day' | 'month' = 'day'): string {
  const [y, m, d] = iso.split('-');
  if (bucket === 'month') return MONTHS[Number(m) - 1] ?? m;
  void y;
  return `${d}/${m}`;
}

/** Short axis labels that stay distinct: 750, 1.5k, 2.3k, 12k. */
function axisTick(v: number): string {
  if (v === 0) return '0';
  if (v < 1000) return String(Math.round(v));
  const k = v / 1000;
  return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}k`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

/* ───────────── sales vs expenses, last N days ───────────── */

export function TrendChart({
  data,
  bucket = 'day',
  title = 'Sales & expenses',
  subtitle,
  control,
}: {
  data: Array<{ date: string; sales: string; expenses: string }>;
  bucket?: 'day' | 'month';
  title?: string;
  subtitle?: string;
  control?: ReactNode;
}) {
  const W = 760;
  const H = 220;
  const PAD = { top: 14, right: 10, bottom: 24, left: 52 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (data.length === 0) {
    return (
      <figure className="chart">
        <figcaption className="chart-head">
          <div>
            <h3>{title}</h3>
            <p className="muted-3">{subtitle ?? ''}</p>
          </div>
          <div className="chart-head-right">{control}</div>
        </figcaption>
        <div className="empty-state">Nothing recorded in this period.</div>
      </figure>
    );
  }

  const sales = data.map((d) => Number(d.sales));
  const expenses = data.map((d) => Number(d.expenses));
  const max = niceCeil(Math.max(1, ...sales, ...expenses));

  const x = (i: number) => PAD.left + (plotW / Math.max(1, data.length - 1)) * i;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const line = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const barW = Math.max(3, plotW / data.length - 8);

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <h3>{title}</h3>
          <p className="muted-3">{subtitle ?? `Last ${data.length} days`}</p>
        </div>
        <div className="chart-head-right">
          <div className="chart-legend">
            <span><i className="swatch sales" /> Sales</span>
            <span><i className="swatch expenses" /> Expenses</span>
          </div>
          {control}
        </div>
      </figcaption>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
           aria-label={`Sales and expenses, ${data.length} ${bucket === "month" ? "months" : "days"}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t) + 3.5} className="axis" textAnchor="end">
              {axisTick(t)}
            </text>
          </g>
        ))}

        {/* expenses as bars behind the sales line - they are the smaller,
            chunkier series, so they read better as volume than as a line */}
        {expenses.map((v, i) => (
          <rect
            key={i}
            x={x(i) - barW / 2}
            y={y(v)}
            width={barW}
            height={Math.max(0, PAD.top + plotH - y(v))}
            rx={2}
            className="bar-expense"
          >
            <title>{`${shortDate(data[i].date)} - expenses ${formatMoney(v)}`}</title>
          </rect>
        ))}

        <path d={line(sales)} className="line-sales" />
        {sales.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={2.6} className="dot-sales">
            <title>{`${shortDate(data[i].date)} - sales ${formatMoney(v)}`}</title>
          </circle>
        ))}

        {data.map((d, i) =>
          i % Math.ceil(data.length / 7) === 0 ? (
            <text key={d.date} x={x(i)} y={H - 6} className="axis" textAnchor="middle">
              {shortDate(d.date, bucket)}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}

/* ───────────── receivables vs payables donut ───────────── */

export function BalanceDonut({
  receivables,
  payables,
  cash,
}: {
  receivables: number;
  payables: number;
  cash: number;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const total = Math.max(1, receivables + payables);
  const recFrac = receivables / total;

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <h3>Who owes who</h3>
          <p className="muted-3">Receivables against payables</p>
        </div>
      </figcaption>

      <div className="donut-wrap">
        <svg viewBox="0 0 140 140" className="donut" role="img"
             aria-label={`Receivables ${receivables}, payables ${payables}`}>
          <circle cx="70" cy="70" r={R} className="donut-track" />
          <circle
            cx="70" cy="70" r={R}
            className="donut-rec"
            strokeDasharray={`${C * recFrac} ${C}`}
            transform="rotate(-90 70 70)"
          />
          <text x="70" y="65" textAnchor="middle" className="donut-value">
            {Math.round(recFrac * 100)}%
          </text>
          <text x="70" y="82" textAnchor="middle" className="donut-label">
            receivable
          </text>
        </svg>

        <ul className="donut-key">
          <li>
            <i className="swatch sales" />
            <span>Farmers owe you</span>
            <b>{formatMoney(receivables)}</b>
          </li>
          <li>
            <i className="swatch payable" />
            <span>You owe suppliers</span>
            <b>{formatMoney(payables)}</b>
          </li>
          <li className="net">
            <i className="swatch cash" />
            <span>Cash &amp; bank</span>
            <b>{formatMoney(cash)}</b>
          </li>
        </ul>
      </div>
    </figure>
  );
}

/* ───────────── top products ───────────── */

export function TopProducts({
  items,
}: {
  items: Array<{ name: string; quantity: string; value: string }>;
}) {
  const max = Math.max(1, ...items.map((i) => Number(i.value)));

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <h3>Top sellers</h3>
          <p className="muted-3">By value, this month</p>
        </div>
      </figcaption>

      {items.length === 0 ? (
        <div className="empty-state">No sales recorded this month yet.</div>
      ) : (
        <ul className="bar-list">
          {items.map((item) => (
            <li key={item.name}>
              <div className="bar-list-top">
                <span className="bar-list-name" title={item.name}>{item.name}</span>
                <span className="bar-list-value">{formatMoney(item.value)}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(Number(item.value) / max) * 100}%` }} />
              </div>
              <div className="bar-list-sub">{item.quantity} sold</div>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
