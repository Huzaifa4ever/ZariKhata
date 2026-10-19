/**
 * Shared A4 print chrome for every printed document - reports, farmer
 * statements and customer bills.
 *
 * It all goes through one file so a bill and a statement can't drift apart:
 * same brand mark, same header block, same type scale, same footer. Printing
 * opens a popup and hands off to the OS print dialog, which is also how the
 * user gets a PDF ("Save as PDF" / "Microsoft Print to PDF") - no PDF library
 * to ship, and no extra request on a page the shopkeeper is waiting on.
 */

export interface PrintBusiness {
  name?: string;
  address?: string;
  phone?: string;
}

/** The ZariKhata mark, inlined - a popup window can't reach the app's assets. */
const MARK = `<svg viewBox="0 0 64 64" width="34" height="34" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="17" fill="#0a6e42"/>
  <g transform="translate(16,16)">
    <path d="M4.5 27.5 C4.5 14 14 4.5 27.5 4.5 C27.5 18 18 27.5 4.5 27.5 Z" fill="#ffffff"/>
    <path d="M11 11.5 H21.4 L11 20.9 H21.4" fill="none" stroke="#073d25" stroke-width="2.7"
          stroke-linejoin="round" stroke-linecap="round"/>
  </g>
</svg>`;

export function esc(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function rs(v: number | string): string {
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function printedAt(): string {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function getBusiness(): PrintBusiness {
  try {
    const stored = localStorage.getItem('zk_business');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/** The one stylesheet every printed document uses. */
export const PRINT_CSS = `
  @page { size: A4 portrait; margin: 14mm 13mm 16mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', -apple-system, Roboto, Arial, sans-serif;
    font-size: 9.6pt; line-height: 1.45; color: #10211a; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 184mm; margin: 0 auto; }

  /* --- header --- */
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px;
              padding-bottom: 10px; border-bottom: 2px solid #0a6e42; }
  .brand { display: flex; gap: 10px; align-items: flex-start; }
  .brand-text .shop { font-size: 14.5pt; font-weight: 700; letter-spacing: -.02em; color: #0a6e42; line-height: 1.15; }
  .brand-text .addr { font-size: 8.4pt; color: #55635d; margin-top: 2px; max-width: 72mm; }
  .brand-text .by { font-size: 7.2pt; color: #8a968f; letter-spacing: .12em; text-transform: uppercase; margin-top: 3px; }
  .doc-meta { text-align: right; }
  .doc-type { font-size: 12.5pt; font-weight: 700; letter-spacing: -.01em; color: #10211a; }
  .doc-sub { font-size: 8.6pt; color: #55635d; margin-top: 2px; }
  .doc-ref { font-size: 8.6pt; margin-top: 4px; }
  .doc-ref b { font-weight: 600; }

  /* --- party / info strip --- */
  .strip { display: flex; gap: 10px; margin-top: 12px; }
  .strip-box { flex: 1; border: 1px solid #dde5e1; border-radius: 5px; padding: 8px 10px; background: #f7faf8; }
  .strip-box .k { font-size: 7.2pt; text-transform: uppercase; letter-spacing: .09em; color: #7b8781; }
  .strip-box .v { font-size: 10pt; font-weight: 600; margin-top: 1px; }
  .strip-box .m { font-size: 8.4pt; color: #55635d; }

  /* --- table --- */
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  thead { display: table-header-group; }   /* repeat the header on every page */
  tr { page-break-inside: avoid; }
  th { font-size: 7.6pt; text-transform: uppercase; letter-spacing: .07em; text-align: left;
       color: #41504a; background: #eef3f0; border-bottom: 1px solid #cfdad4;
       padding: 6px 7px; font-weight: 700; }
  td { padding: 5.5px 7px; border-bottom: 1px solid #e8eeeb; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fbfcfb; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .muted { color: #6b7873; }

  /* --- totals --- */
  .totals { margin-top: 12px; margin-left: auto; width: 74mm; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 9.6pt; }
  .totals .row.grand { border-top: 1.6px solid #0a6e42; margin-top: 3px; padding-top: 7px;
                       font-size: 11.5pt; font-weight: 700; color: #0a6e42; }
  .totals .row .n { font-variant-numeric: tabular-nums; }

  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .summary .cell { flex: 1; min-width: 32mm; border: 1px solid #dde5e1; border-radius: 5px; padding: 7px 9px; }
  .summary .cell.hl { border-color: #0a6e42; background: #f1faf4; }
  .summary .cell .k { font-size: 7.2pt; text-transform: uppercase; letter-spacing: .08em; color: #7b8781; }
  .summary .cell .v { font-size: 11pt; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .summary .cell.hl .v { color: #0a6e42; }

  h2.section { font-size: 9.6pt; text-transform: uppercase; letter-spacing: .09em;
               color: #41504a; margin-top: 16px; padding-bottom: 3px; border-bottom: 1px solid #dde5e1; }

  .note { margin-top: 14px; padding: 8px 10px; border-left: 2.5px solid #0a6e42;
          background: #f7faf8; font-size: 8.6pt; color: #41504a; }
  .sign { display: flex; justify-content: space-between; margin-top: 20mm; gap: 20mm; }
  .sign div { flex: 1; border-top: 1px solid #b9c5bf; padding-top: 4px;
              font-size: 8.2pt; color: #6b7873; text-align: center; }

  .doc-foot { margin-top: 14px; padding-top: 7px; border-top: 1px solid #e2e9e5;
              display: flex; justify-content: space-between; font-size: 7.6pt; color: #8a968f; }
  .empty { padding: 18px; text-align: center; color: #8a968f; font-size: 9pt; }
  @media print { .no-print { display: none !important; } }
`;

export interface HeaderOptions {
  business: PrintBusiness;
  /** e.g. "Sales Report", "Account Statement", "Invoice" */
  docType: string;
  subtitle?: string;
  /** Right-hand reference lines, e.g. { 'Invoice #': 'S-00012' } */
  refs?: Record<string, string>;
}

export function headerHtml({ business, docType, subtitle, refs = {} }: HeaderOptions): string {
  const refLines = Object.entries(refs)
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="doc-ref">${esc(k)} <b>${esc(v)}</b></div>`)
    .join('');

  return `<div class="doc-head">
    <div class="brand">
      ${MARK}
      <div class="brand-text">
        <div class="shop">${esc(business.name || 'ZariKhata')}</div>
        ${business.address ? `<div class="addr">${esc(business.address)}</div>` : ''}
        ${business.phone ? `<div class="addr">Phone: ${esc(business.phone)}</div>` : ''}
        <div class="by">Powered by ZariKhata</div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-type">${esc(docType)}</div>
      ${subtitle ? `<div class="doc-sub">${esc(subtitle)}</div>` : ''}
      ${refLines}
    </div>
  </div>`;
}

export function footerHtml(): string {
  return `<div class="doc-foot">
    <span>Generated ${esc(printedAt())} (PKT)</span>
    <span>ZariKhata - Agro Business · Accounts · Stock</span>
  </div>`;
}

/** Open the document in a popup and trigger the print dialog. */
export function openPrintWindow(title: string, bodyHtml: string): void {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for ZariKhata and try again.');
    return;
  }
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>${esc(title)}</title><style>${PRINT_CSS}</style></head>
    <body><div class="sheet">${bodyHtml}</div>
    <script>window.onload=function(){window.focus();window.print();};<\/script>
    </body></html>`);
  win.document.close();
}

/* ══════════════════════ thermal receipt (80mm / 58mm) ══════════════════════
   A counter receipt is a different document from an A4 report: one narrow
   column, no colour (thermal paper is monochrome), large type for the total,
   and the roll is cut at the end rather than paged. The brand mark is drawn
   in pure black for the same reason - a green gradient prints as mud. */

export type ReceiptWidth = '58mm' | '80mm';

const MARK_MONO = `<svg viewBox="0 0 64 64" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="17" fill="#000"/>
  <g transform="translate(16,16)">
    <path d="M4.5 27.5 C4.5 14 14 4.5 27.5 4.5 C27.5 18 18 27.5 4.5 27.5 Z" fill="#fff"/>
    <path d="M11 11.5 H21.4 L11 20.9 H21.4" fill="none" stroke="#000" stroke-width="3.1"
          stroke-linejoin="round" stroke-linecap="round"/>
  </g>
</svg>`;

export function receiptCss(width: ReceiptWidth): string {
  // Printable area, allowing for the few mm the printer cannot reach.
  const paper = width === '58mm' ? '58mm' : '80mm';
  const content = width === '58mm' ? '48mm' : '72mm';
  const base = width === '58mm' ? '8.5pt' : '9.5pt';
  return `
  @page { size: ${paper} auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${content};
    margin: 0 auto;
    padding: 3mm 0 6mm;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: ${base};
    line-height: 1.35;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .shop { font-size: 1.25em; font-weight: 700; letter-spacing: -.01em; margin-top: 2mm; }
  .small { font-size: .85em; }
  .rule { border-top: 1px dashed #000; margin: 2mm 0; }
  .rule-solid { border-top: 1.5px solid #000; margin: 1.5mm 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: .8em; text-transform: uppercase; letter-spacing: .05em;
       border-bottom: 1px solid #000; padding: 1mm 0; }
  th.r, td.r { text-align: right; }
  td { padding: .9mm 0; vertical-align: top; }
  .item-name { font-weight: 600; }
  .tot { display: flex; justify-content: space-between; padding: .6mm 0; }
  .tot.grand { font-size: 1.3em; font-weight: 700; padding: 1.5mm 0; }
  .foot { margin-top: 3mm; font-size: .82em; }
  `;
}

/** Opens the receipt in a popup sized to the roll and prints it. */
export function openReceiptWindow(title: string, width: ReceiptWidth, bodyHtml: string): void {
  const win = window.open('', '_blank', 'width=420,height=760');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for ZariKhata and try again.');
    return;
  }
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>${esc(title)}</title><style>${receiptCss(width)}</style></head>
    <body>${bodyHtml}
    <script>window.onload=function(){window.focus();window.print();};<\/script>
    </body></html>`);
  win.document.close();
}

export function receiptHeaderHtml(business: PrintBusiness): string {
  return `<div class="c">
    ${MARK_MONO}
    <div class="shop">${esc(business.name || 'ZariKhata')}</div>
    ${business.address ? `<div class="small">${esc(business.address)}</div>` : ''}
    ${business.phone ? `<div class="small">Ph: ${esc(business.phone)}</div>` : ''}
  </div>`;
}
