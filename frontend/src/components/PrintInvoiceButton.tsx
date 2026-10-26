import { useState } from 'react';
import { IconPrint } from './icons';
import { ApiError } from '../api/client';
import * as api from '../api/resources';
import { printInvoiceA4, printInvoiceReceipt } from './PrintInvoice';

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

  async function go(mode: 'receipt' | 'a4') {
    setBusy(true);
    setOpen(false);
    try {
      const inv = await api.lookupInvoice(invoiceNumber);
      if (mode === 'receipt') printInvoiceReceipt(inv);
      else printInvoiceA4(inv);
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
          <button onClick={() => go('receipt')}>Receipt (80mm)</button>
          <button onClick={() => go('a4')}>Invoice (A4)</button>
        </span>
      )}
    </span>
  );
}
