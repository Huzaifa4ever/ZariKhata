import { startOfBusinessMonth, endOfBusinessMonth, parseBusinessDate, parseBusinessDateEnd } from './dates';

export function parseDateRange(query: Record<string, unknown>): { from: Date; to: Date } {
  const from = typeof query.from === 'string' && query.from ? parseBusinessDate(query.from) : startOfBusinessMonth();
  const to = typeof query.to === 'string' && query.to ? parseBusinessDateEnd(query.to) : endOfBusinessMonth();
  return { from, to };
}
