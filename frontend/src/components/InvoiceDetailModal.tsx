import { useQuery } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, ErrorBanner } from './StatusBits';
import { IconPrint } from './icons';
import * as api from '../api/resources';
import { formatMoney } from '../lib/format';
import { printInvoiceA4, printInvoiceReceipt } from './PrintInvoice';

/**
 * One invoice in full. Used where a party record cannot be opened - a walk-in
 * sale has no account to show, but the sale itself still has everything worth
 * seeing, so the name opens this instead of being dead text.
 */
export function InvoiceDetailModal({ invoiceNumber, onClose }: { invoiceNumber: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['invoice-lookup', invoiceNumber],
    queryFn: () => api.lookupInvoice(invoiceNumber),
  });

  return (
    <Modal title={invoiceNumber} onClose={onClose}>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load this invoice." />}

      {data && (
        <>
          <div className="party-head">
            <div className="party-meta">
              <span>{data.party.name}</span>
              <span>{data.date}</span>
              <span>{data.status}</span>
            </div>
            <div className="btn-row">
              <button className="btn secondary small" onClick={() => printInvoiceReceipt(data)}>
                <IconPrint size={14} /> Receipt
              </button>
              <button className="btn small" onClick={() => printInvoiceA4(data)}>
                <IconPrint size={14} /> A4
              </button>
            </div>
          </div>

          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">Total</div>
              <div className="value">{formatMoney(data.total)}</div>
            </div>
            <div className="stat-card">
              <div className="label">Paid</div>
              <div className="value">{formatMoney(data.amountPaid)}</div>
            </div>
            <div className={`stat-card${Number(data.balance) > 0 ? ' danger' : ' accent'}`}>
              <div className="label">Balance</div>
              <div className="value">{formatMoney(data.balance)}</div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.product}
                      <div className="cell-muted" style={{ fontSize: 11.5 }}>{l.sku}</div>
                    </td>
                    <td className="text-right">{l.quantity}</td>
                    <td className="text-right">{formatMoney(l.unitPrice)}</td>
                    <td className="text-right">{formatMoney(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
