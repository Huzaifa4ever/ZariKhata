import { useState } from 'react';
import { IconPrint } from './icons';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { printInvoiceA4, printInvoiceReceipt } from './PrintInvoice';

/**
 * Which thermal roll the shop keeps in its printer.
 *
 * printInvoiceReceipt has always taken a width, but the only button said
 * "Receipt (80mm)", so a shop with a 58mm printer had no way to reach the
 * narrow layout. Remembered per browser: it is a property of the printer on
 * that counter, not of the invoice.
 */
const WIDTH_KEY = 'zarikhata_receipt_width';

function savedWidth(): '58mm' | '80mm' {
  try {
    return localStorage.getItem(WIDTH_KEY) === '58mm' ? '58mm' : '80mm';
  } catch {
    return '80mm';
  }
}

function rememberWidth(width: '58mm' | '80mm') {
  try {
    localStorage.setItem(WIDTH_KEY, width);
  } catch {
    // Storage blocked - the choice just won't be remembered next time.
  }
}

/**
 * Print one invoice, as a counter receipt or an A4 office copy.
 *
 * Fetches the invoice on click rather than printing from the list row: the row
 * has totals but not the line items, and a receipt that omits what was sold is
 * useless to the customer holding it.
 */
export function PrintInvoiceButton({ invoiceNumber }: { invoiceNumber: string }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function go(mode: '58mm' | '80mm' | 'a4') {
    setBusy(true);
    setOpen(false);
    try {
      const inv = await api.lookupInvoice(invoiceNumber);
      if (mode === 'a4') printInvoiceA4(inv);
      else {
        rememberWidth(mode);
        printInvoiceReceipt(inv, mode);
      }
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Could not load that invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="print-split">
      <button
        className="btn secondary small"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title={`Print ${invoiceNumber}`}
      >
        <IconPrint size={14} />
        {busy ? '...' : 'Print'}
      </button>
      {open && (
        <span className="print-menu" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => go('80mm')}>
            Receipt - 80mm roll{savedWidth() === '80mm' ? ' ·' : ''}
          </button>
          <button onClick={() => go('58mm')}>
            Receipt - 58mm roll{savedWidth() === '58mm' ? ' ·' : ''}
          </button>
          <button onClick={() => go('a4')}>Invoice (A4)</button>
        </span>
      )}
    </span>
  );
}
