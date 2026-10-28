/**
 * Ledger primitives - the vocabulary the dashboard is written in.
 *
 * The organising idea is a printed financial statement rather than a grid of
 * cards: figures hang on a measure, structure comes from graded rules, and
 * colour is ink rather than tint. Four pigments, each with exactly one
 * meaning, each laid down at full strength:
 *
 *   green  money that is yours
 *   ink    money spent or gone out
 *   gold   age, and nothing else
 *   red    late, lost, or out
 *
 * There is no alpha in here except inside the green ink block, where no
 * pigment exists to grade against. Every other mark ships at opacity 1 on a
 * chosen ramp step - the previous design expressed its entire colour story as
 * four low-alpha washes, which is exactly what read as "dull".
 */
import { useId, type ReactNode } from 'react';
import { formatMoney } from '../lib/format';

/* ─────────────────────────── money ─────────────────────────── */

/**
 * `Rs 3,550.00` set the way a statement sets it: the symbol and the paise
 * demoted so the rupees carry the line.
 *
 * formatMoney stays the single source of truth - it supplies the title and
 * the accessible name, and is untouched at its other sixteen call sites.
 * Colour comes from currentColor so one component works on white paper and on
 * the green ink block alike.
 */
export function Money({ value, className = '' }: { value: string | number | null | undefined; className?: string }) {
  const full = formatMoney(value);
  const match = full.match(/^(\S+)\s(.*?)(\.\d+)?$/);
  if (!match) return <span className={`money ${className}`}>{full}</span>;
  const [, symbol, whole, frac] = match;
  return (
    <span className={`money ${className}`} title={full}>
      <span className="sym">{symbol}</span>
      {whole}
      {frac && <span className="frac">{frac}</span>}
    </span>
  );
}

/* ─────────────────────── section rubric ─────────────────────── */

/**
 * A numbered rubric instead of a seventh identical uppercase label. The
 * numeral is the ledger form; the heading underneath is plain speech, because
 * a shopkeeper reads "Who owes you money", not "Accounts Receivable".
 */
export function Rubric({ seq, title, note }: { seq: string; title: string; note?: string }) {
  return (
    <div className="rubric">
      <div className="seq">{seq}</div>
      <h2>{title}</h2>
      {note && <p className="rubric-note">{note}</p>}
    </div>
  );
}

/* ───────────────────────── sparkline ───────────────────────── */

/**
 * Fourteen days of shape behind a single figure. The median is drawn as a
 * rule so the last point reads as above or below an ordinary day - a number
 * with no baseline cannot tell you whether it is good.
 */
export function Sparkline({ values, width = 108, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const x = (i: number) => (width / (values.length - 1)) * i;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const last = values[values.length - 1];
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={width} y1={y(median)} y2={y(median)} className="spark-median" />
      <path d={path} className="spark-line" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.6" className={`spark-dot${last >= median ? '' : ' under'}`} />
    </svg>
  );
}

/* ─────────────────── the month's account ─────────────────── */

export interface AccountRow {
  label: string;
  value: number;
  /** total bars are green (yours), cost bars are ink (gone out). */
  kind: 'total' | 'cost' | 'result';
}

/**
 * The month argued as a statement rather than four unrelated cards: revenue,
 * less what the goods cost, less what running the shop cost, equals what is
 * actually left. Bar length is shared across the whole statement so the
 * deductions are visibly eating the revenue - four separate cards cannot show
 * that relationship at all.
 */
export function MonthAccount({ rows }: { rows: AccountRow[] }) {
  const scale = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="account">
      {rows.map((r, i) => {
        const pct = (Math.abs(r.value) / scale) * 100;
        const negative = r.value < 0;
        return (
          <div className={`account-row ${r.kind}${negative ? ' negative' : ''}`} key={i}>
            <div className="account-label">{r.label}</div>
            <div className="account-track">
              <div className="account-bar" style={{ width: `${pct}%` }} />
            </div>
            <div className="account-value">
              {negative ? <>(<Money value={Math.abs(r.value)} />)</> : <Money value={r.value} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────── receivables aging ───────────────────── */

export interface AgeBucket {
  label: string;
  amount: number;
}

/**
 * Gold is age and nothing else, so the ramp can be read without a legend:
 * the older the money, the deeper the gold, and anything past 90 days goes
 * red because at that point it is not ageing, it is lost.
 */
export function AgingStrip({ buckets }: { buckets: AgeBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  if (total <= 0) return null;
  return (
    <div className="aging">
      <div className="aging-bar" role="img" aria-label={`Receivables by age, total ${formatMoney(total)}`}>
        {buckets.map((b, i) =>
          b.amount > 0 ? (
            <div
              key={b.label}
              className={`aging-seg age-${i}`}
              style={{ width: `${(b.amount / total) * 100}%` }}
              title={`${b.label}: ${formatMoney(b.amount)}`}
            />
          ) : null,
        )}
      </div>
      <ul className="aging-key">
        {buckets.map((b, i) => (
          <li key={b.label}>
            <i className={`age-swatch age-${i}`} />
            <span className="aging-key-label">{b.label}</span>
            <Money value={b.amount} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────── ranked parties ─────────────────────── */

/**
 * Who owes what, as a ranked bar list. The bar is the comparison; the name
 * and figure are the record. Clicking a row is the whole point - a balance
 * you cannot act on is a decoration.
 */
export function RankedBars({
  rows,
  tone = 'green',
  onPick,
  empty = 'Nothing outstanding.',
}: {
  rows: Array<{ id: number; name: string; amount: string }>;
  tone?: 'green' | 'ink';
  onPick?: (row: { id: number; name: string; amount: string }) => void;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="ledger-empty">{empty}</p>;
  const scale = Math.max(...rows.map((r) => Number(r.amount)), 1);
  return (
    <ul className={`ranked ranked-${tone}`}>
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="ranked-row" onClick={() => onPick?.(r)} disabled={!onPick}>
            <span className="ranked-name">{r.name}</span>
            <span className="ranked-track">
              <span className="ranked-bar" style={{ width: `${(Number(r.amount) / scale) * 100}%` }} />
            </span>
            <Money value={r.amount} className="ranked-value" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────── reorder bullets ────────────────────── */

/**
 * A bullet chart per product: the bar is what is on the shelf, the tick is
 * the reorder threshold. Past the tick is fine, short of it is a call on your
 * attention, zero is red. A bare count ("3 low") names a number; this names
 * the products and how short each one is.
 */
export function ReorderBullets({
  rows,
}: {
  rows: Array<{ id: number; name: string; stock: number; threshold: number; unit: string }>;
}) {
  if (rows.length === 0) return <p className="ledger-empty">Every line is above its reorder level.</p>;
  return (
    <ul className="bullets">
      {rows.map((r) => {
        const scale = Math.max(r.threshold * 1.6, r.stock, 1);
        return (
          <li key={r.id}>
            <span className="bullet-name">{r.name}</span>
            <span className="bullet-track">
              <span
                className={`bullet-bar${r.stock <= 0 ? ' out' : ''}`}
                style={{ width: `${(r.stock / scale) * 100}%` }}
              />
              <span className="bullet-tick" style={{ left: `${(r.threshold / scale) * 100}%` }} />
            </span>
            <span className="bullet-qty">
              {r.stock <= 0 ? 'out' : `${r.stock} ${r.unit}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────── solvency rule ───────────────────── */

/**
 * One rule inside the ink block showing what is owed to you against what you
 * owe. It replaces the donut, which spent a 132px circle to encode a single
 * ratio and was unreadable at a glance.
 */
export function SolvencyRule({ receivable, payable }: { receivable: number; payable: number }) {
  const id = useId();
  const total = receivable + payable;
  const pct = total > 0 ? (receivable / total) * 100 : 0;
  return (
    <div className="solvency" aria-labelledby={id}>
      <div className="solvency-bar">
        <div className="solvency-in" style={{ width: `${pct}%` }} />
      </div>
      <div className="solvency-key" id={id}>
        <span>
          <i className="dot in" /> Owed to you <Money value={receivable} />
        </span>
        <span>
          <i className="dot out" /> You owe <Money value={payable} />
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── band shell ───────────────────────── */

export function Band({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`band ${className}`}>{children}</section>;
}
