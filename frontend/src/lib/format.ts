export function formatMoney(value: string | number | undefined | null, symbol = 'Rs'): string {
  if (value === undefined || value === null) return `${symbol} 0`;
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return `${symbol} 0`;
  // `+ 0` turns -0 into 0. A subtraction that lands exactly on zero produces
  // negative zero in JavaScript, and the shop was reading "Rs -0.00" under
  // Running costs on a day with no costs at all.
  return `${symbol} ${(n + 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatQty(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '0';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '0';
  // Trim trailing zeros on the fractional part for a cleaner look (e.g. "10" not "10.000").
  return (n + 0).toLocaleString('en-PK', { maximumFractionDigits: 3 });
}

export function formatDate(value: string | number | Date | undefined | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', year: 'numeric', month: 'short', day: '2-digit' }).format(d);
}

// The shop's date, not the computer's and not UTC. `toISOString()` would give
// the UTC date, which is a day behind Pakistan between midnight and 5am - and
// anything stamped with that date falls outside the backend's "today" window.
export function todayIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
}

/**
 * Describe a party balance in words rather than a signed number.
 *
 * A farmer's balance goes negative when they have paid more than they were
 * invoiced - a real situation (advance payment, an overpaid settlement). Shown
 * raw it reads "owes Rs -3,200.00", which looks like a bug and makes a correct
 * payment look like it is moving the wrong way. Say "in credit" instead.
 */
export function describeBalance(
  value: string | number | null | undefined,
  side: 'receivable' | 'payable' = 'receivable',
): { text: string; tone: 'owing' | 'credit' | 'settled'; amount: number } {
  const n = Number(value ?? 0);
  if (Number.isNaN(n) || Math.abs(n) < 0.005) return { text: 'settled up', tone: 'settled', amount: 0 };
  if (n > 0) {
    return {
      text: `${side === 'receivable' ? 'owes' : 'you owe'} ${formatMoney(n)}`,
      tone: 'owing',
      amount: n,
    };
  }
  return { text: `${formatMoney(-n)} in credit`, tone: 'credit', amount: n };
}

/**
 * One date format across the whole app.
 *
 * Sales showed "28 Oct 2026", Reports showed "2026-10-28" and the date picker
 * showed "10/29/2026" - three ways of writing the same day on three screens,
 * and the American one is genuinely ambiguous to a reader here. Everything
 * user-facing goes through formatDate; this is for the places that need the
 * machine form (an <input type="date"> value, a CSV, a query parameter).
 */
export function toIsoDate(value: string | number | Date | undefined | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
}

/** Date plus time, for a cash book where two entries can share a day. */
export function formatDateTime(value: string | number | Date | undefined | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
