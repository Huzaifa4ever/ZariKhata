/**
 * Renders report data as a branded A4 document and sends it to the printer.
 * All the chrome (mark, shop header, type scale, footer) comes from
 * lib/printBrand so reports and bills look like the same company's paperwork.
 */
import {
  esc,
  footerHtml,
  headerHtml,
  openPrintWindow,
  rs,
  type PrintBusiness,
} from '../lib/printBrand';

export interface PrintColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** Format as money with thousands separators and 2 decimals. */
  money?: boolean;
  /** Reference data (invoice numbers, SKUs) - shown, but played down. */
  muted?: boolean;
}

export interface PrintSummaryItem {
  label: string;
  value: string;
  highlight?: boolean;
}

export interface PrintSection {
  heading: string;
  columns: PrintColumn[];
  rows: Array<Record<string, unknown>>;
  emptyLabel?: string;
}

export interface PrintReportOptions {
  title: string;
  subtitle?: string;
  dateRange?: string;
  business: PrintBusiness;
  /** Shown in the strip under the header - the farmer a statement is for. */
  party?: { label: string; name: string; phone?: string; village?: string };
  summary?: PrintSummaryItem[];
  /** One or more tables. A plain report passes a single section. */
  sections: PrintSection[];
  note?: string;
  /** Adds signature lines at the bottom - used on statements. */
  signatures?: boolean;
}

function tableHtml(section: PrintSection): string {
  const { heading, columns, rows, emptyLabel } = section;
  const head = `<h2 class="section">${esc(heading)}</h2>`;

  if (rows.length === 0) {
    return `${head}<div class="empty">${esc(emptyLabel ?? 'Nothing recorded in this period.')}</div>`;
  }

  const ths = columns
    .map((c) => `<th class="${c.align === 'right' || c.money ? 'right' : c.align === 'center' ? 'center' : ''}">${esc(c.label)}</th>`)
    .join('');

  const trs = rows
    .map((row) => {
      const tds = columns
        .map((c) => {
          const raw = row[c.key];
          const cls = [
            c.money || c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : '',
            c.muted ? 'muted' : '',
          ].filter(Boolean).join(' ');
          const value = c.money ? (raw === '' || raw == null ? '' : rs(raw as string)) : raw ?? '-';
          return `<td class="${cls}">${esc(value)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  return `${head}<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function printReport(opts: PrintReportOptions): void {
  const { title, subtitle, dateRange, business, party, summary = [], sections, note, signatures } = opts;

  const strip = party
    ? `<div class="strip">
         <div class="strip-box">
           <div class="k">${esc(party.label)}</div>
           <div class="v">${esc(party.name)}</div>
           ${party.village ? `<div class="m">${esc(party.village)}</div>` : ''}
           ${party.phone ? `<div class="m">${esc(party.phone)}</div>` : ''}
         </div>
         <div class="strip-box">
           <div class="k">Period</div>
           <div class="v">${esc(dateRange ?? 'All time')}</div>
         </div>
       </div>`
    : '';

  const summaryHtml = summary.length
    ? `<div class="summary">${summary
        .map(
          (s) =>
            `<div class="cell${s.highlight ? ' hl' : ''}"><div class="k">${esc(s.label)}</div><div class="v">${esc(
              s.value,
            )}</div></div>`,
        )
        .join('')}</div>`
    : '';

  const body = [
    headerHtml({
      business,
      docType: title,
      subtitle,
      refs: party ? {} : { Period: dateRange ?? 'All time' },
    }),
    strip,
    summaryHtml,
    sections.map(tableHtml).join(''),
    note ? `<div class="note">${esc(note)}</div>` : '',
    signatures
      ? `<div class="sign"><div>Customer signature</div><div>For ${esc(business.name || 'the shop')}</div></div>`
      : '',
    footerHtml(),
  ].join('');

  openPrintWindow(title, body);
}
