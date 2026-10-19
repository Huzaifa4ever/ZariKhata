import { describe, it, expect } from 'vitest';
import {
  parseBusinessDate,
  parseBusinessDateEnd,
  startOfBusinessDay,
  endOfBusinessDay,
  startOfBusinessMonth,
} from '../src/lib/dates';

/**
 * Regression guard for the bug where a newly recorded expense showed up in the
 * dashboard's "this month" figure but not in "today": a date-only `YYYY-MM-DD`
 * was read as UTC midnight, which falls outside the Asia/Karachi business day
 * whenever the UTC and Karachi dates disagree — i.e. 00:00–05:00 local.
 */
describe('business dates', () => {
  it('pins a date-only value to Karachi midnight, not UTC midnight', () => {
    expect(parseBusinessDate('2026-10-19').toISOString()).toBe('2026-10-18T19:00:00.000Z');
  });

  it('keeps an entry inside "today" when recorded in the 00:00-05:00 PKT window', () => {
    // 02:30 Karachi on the 19th. The UTC date is still the 18th.
    const now = new Date('2026-10-18T21:30:00Z');
    const stored = parseBusinessDate('2026-10-19'); // the form now sends the Karachi date

    expect(stored >= startOfBusinessDay(now)).toBe(true);
    expect(stored <= endOfBusinessDay(now)).toBe(true);
    expect(stored >= startOfBusinessMonth(now)).toBe(true);
  });

  it('reproduces the old failure, so the guard above is meaningful', () => {
    const now = new Date('2026-10-18T21:30:00Z');
    const oldBehaviour = new Date('2026-10-18'); // UTC date, parsed as UTC midnight
    expect(oldBehaviour >= startOfBusinessDay(now)).toBe(false); // missed "today"
    expect(oldBehaviour >= startOfBusinessMonth(now)).toBe(true); // but counted in "month"
  });

  it('treats a date-only range end as the end of that business day', () => {
    // A report run "to 19 Oct" must include an 11am sale on the 19th.
    const saleAt11am = new Date('2026-10-19T06:00:00Z');
    expect(saleAt11am <= parseBusinessDateEnd('2026-10-19')).toBe(true);
    expect(saleAt11am <= new Date('2026-10-19')).toBe(false); // what it used to do
  });

  it('passes through a value that already states its own instant', () => {
    expect(parseBusinessDate('2026-10-19T06:30:00.000Z').toISOString()).toBe('2026-10-19T06:30:00.000Z');
  });
});
