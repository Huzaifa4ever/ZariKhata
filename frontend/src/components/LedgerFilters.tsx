/**
 * The row of controls above a list of documents, and the paging under it.
 *
 * Sales, Purchases and Expenses were all unfiltered, unpaged lists. That is
 * fine for a week and unusable after a season: finding one invoice from March
 * meant scrolling past every invoice since. The backend already accepted
 * from/to/status/q - nothing was passing them.
 *
 * Paging is done in the browser rather than with a LIMIT. The lists are a few
 * thousand rows at most, the server already sends them whole, and keeping the
 * full set in hand means the totals under the table are totals for the filter,
 * not for the page - which is the number the owner actually wants.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconSearch } from './icons';

export const PAGE_SIZE = 50;

export interface DateRange {
  from: string;
  to: string;
}

/** Shared "last 30 days / this month / everything" shortcuts. */
export function rangePresets(): { label: string; from: string; to: string }[] {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d);
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const last30 = new Date(today);
  last30.setDate(last30.getDate() - 30);
  return [
    { label: 'This month', from: fmt(monthStart), to: fmt(today) },
    { label: 'Last 30 days', from: fmt(last30), to: fmt(today) },
    { label: 'Everything', from: '', to: '' },
  ];
}

export function FilterBar({
  search,
  onSearch,
  searchPlaceholder,
  range,
  onRange,
  children,
  resultCount,
  totalCount,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  range: DateRange;
  onRange: (range: DateRange) => void;
  /** A status <select> or anything else the page needs. */
  children?: ReactNode;
  resultCount: number;
  totalCount: number;
}) {
  const filtered = resultCount !== totalCount;
  return (
    <div className="filter-bar">
      <label className="field inline grow">
        <span>Search</span>
        <div className="combo" style={{ width: '100%' }}>
          <IconSearch size={15} className="combo-icon" />
          <input
            className="combo-input"
            type="search"
            value={search}
            placeholder={searchPlaceholder}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </label>

      <label className="field inline">
        <span>From</span>
        <input type="date" value={range.from} onChange={(e) => onRange({ ...range, from: e.target.value })} />
      </label>
      <label className="field inline">
        <span>To</span>
        <input type="date" value={range.to} onChange={(e) => onRange({ ...range, to: e.target.value })} />
      </label>

      {children}

      <label className="field inline">
        <span>Quick</span>
        <select
          value=""
          onChange={(e) => {
            const preset = rangePresets().find((p) => p.label === e.target.value);
            if (preset) onRange({ from: preset.from, to: preset.to });
          }}
        >
          <option value="">Choose…</option>
          {rangePresets().map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <span className="filter-count">
        {filtered ? `${resultCount} of ${totalCount}` : `${totalCount} record${totalCount === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}

/** Keeps a page index that resets whenever the filtered set changes under it. */
export function usePaged<T>(rows: T[]): {
  page: T[];
  pager: ReactNode;
} {
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // Filtering down to three rows while sitting on page 7 would show nothing.
  useEffect(() => {
    setPageIndex((i) => Math.min(i, pageCount - 1));
  }, [pageCount]);

  const page = useMemo(
    () => rows.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE),
    [rows, pageIndex],
  );

  const first = rows.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
  const last = Math.min(rows.length, (pageIndex + 1) * PAGE_SIZE);

  const pager =
    rows.length <= PAGE_SIZE ? null : (
      <div className="pager">
        <span className="pager-status">
          Showing {first}-{last} of {rows.length}
        </span>
        <div className="pager-buttons">
          <button
            type="button"
            className="btn secondary small"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => i - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn secondary small"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((i) => i + 1)}
          >
            Next
          </button>
        </div>
      </div>
    );

  return { page, pager };
}

/** Case and punctuation insensitive, same rule as the product search. */
export function textMatches(haystack: string, query: string): boolean {
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hay = normalize(haystack);
  return query
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** Compares the day part only, so the "to" date is inclusive. */
export function withinRange(iso: string, range: DateRange): boolean {
  const day = iso.slice(0, 10);
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}
