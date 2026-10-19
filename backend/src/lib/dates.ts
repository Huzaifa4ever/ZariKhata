// All business-date filtering (dashboard "today", monthly/yearly reports) is
// done in Asia/Karachi local time, independent of the server's own timezone.
// Pakistan has not observed DST since 2009, so PKT is a fixed UTC+05:00 —
// safe to hardcode for range math. Display formatting still goes through
// Intl so the timezone name stays correct if that policy ever changes.

export const BUSINESS_TIMEZONE = 'Asia/Karachi';

export function formatBusinessDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // en-CA locale yields YYYY-MM-DD
}

export function formatBusinessDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Start of the given business day, as a UTC instant. Defaults to today. */
export function startOfBusinessDay(date: Date = new Date()): Date {
  const ymd = formatBusinessDate(date);
  return new Date(`${ymd}T00:00:00+05:00`);
}

export function endOfBusinessDay(date: Date = new Date()): Date {
  const start = startOfBusinessDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function startOfBusinessMonth(date: Date = new Date()): Date {
  const ymd = formatBusinessDate(date);
  const [year, month] = ymd.split('-');
  return new Date(`${year}-${month}-01T00:00:00+05:00`);
}

export function endOfBusinessMonth(date: Date = new Date()): Date {
  const start = startOfBusinessMonth(date);
  const nextMonth = new Date(start);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return new Date(nextMonth.getTime() - 1);
}

export function startOfBusinessYear(date: Date = new Date()): Date {
  const ymd = formatBusinessDate(date);
  const year = ymd.split('-')[0];
  return new Date(`${year}-01-01T00:00:00+05:00`);
}

export function endOfBusinessYear(date: Date = new Date()): Date {
  const start = startOfBusinessYear(date);
  const nextYear = new Date(start);
  nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
  return new Date(nextYear.getTime() - 1);
}

export function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a date coming in from a client.
 *
 * A bare `YYYY-MM-DD` (what every `<input type="date">` sends) has no timezone,
 * so `new Date(s)` reads it as UTC midnight. Our day/month/year windows are
 * Asia/Karachi local, which starts at 19:00 UTC the previous day — so a
 * UTC-midnight value lands outside the business day it was meant for whenever
 * the UTC date and the Karachi date disagree, i.e. between 00:00 and 05:00 PKT.
 * That is what made a fresh expense show up in "this month" but not in "today".
 *
 * Date-only input is therefore pinned to business-local midnight. Anything that
 * already carries a time and offset is trusted as the exact instant it states.
 */
export function parseBusinessDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (DATE_ONLY.test(value)) return new Date(`${value}T00:00:00+05:00`);
  return new Date(value);
}

/**
 * Same, but for the exclusive-feeling `to` end of a range: a date-only value
 * means "through the end of that business day", not "at its first instant".
 * Without this, a report run `to=2026-10-19` silently drops everything that
 * happened on the 19th.
 */
export function parseBusinessDateEnd(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (DATE_ONLY.test(value)) return endOfBusinessDay(new Date(`${value}T12:00:00+05:00`));
  return new Date(value);
}
