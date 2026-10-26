/**
 * Every delivery logged against one purchase, and - in admin mode - the way
 * to undo one that was confirmed by mistake.
 *
 * Undoing takes the stock back off the shelf and re-opens the order, which is
 * only possible while none of it has been sold. Once it has, a purchase return
 * is the honest record instead, and the server says so.
 */
import { useQuery } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, EmptyState } from './StatusBits';
import { DeleteButton } from './DeleteButton';
import { useAdminMode } from '../admin/AdminMode';
import * as api from '../api/resources';
import { formatDate } from '../lib/format';
import type { Purchase } from '../api/types';

export function DeliveryHistoryModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-receipts', purchase.id],
    queryFn: () => api.listPurchaseReceipts(purchase.id),
  });

  return (
    <Modal title={`Deliveries - ${purchase.invoiceNumber}`} onClose={onClose}>
      {isLoading && <LoadingState />}
      {data && data.length === 0 && <EmptyState label="No delivery recorded against this purchase." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Arrived</th>
                <th>What came</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((receipt) => (
                <tr key={receipt.id}>
                  <td>{formatDate(receipt.receivedDate)}</td>
                  <td>
                    {receipt.items.map((line) => (
                      <div key={line.id}>
                        {line.purchaseItem.product?.name ?? 'Item'}:{' '}
                        <strong>{Number(line.quantityAccepted)}</strong> received
                        {Number(line.quantityRejected) > 0 && `, ${Number(line.quantityRejected)} damaged`}
                        {Number(line.quantityCancelled) > 0 && `, ${Number(line.quantityCancelled)} written off`}
                      </div>
                    ))}
                  </td>
                  <td className="cell-muted">
                    {receipt.notes || '-'}
                    {receipt.closedOrder && <div>order closed</div>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                      <DeleteButton
                        resource="purchase-receipts"
                        id={receipt.id}
                        label={`the delivery of ${formatDate(receipt.receivedDate)}`}
                        description="Takes that stock back off the shelf and re-opens the order. Refused if any of it has been sold."
                        invalidate={['purchases', 'purchase-receipts', 'products', 'suppliers', 'accounts']}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** Only offered in admin mode - this is where a confirmed arrival gets undone. */
export function DeliveryHistoryButton({ purchase, onOpen }: { purchase: Purchase; onOpen: () => void }) {
  const { enabled } = useAdminMode();
  if (!enabled) return null;
  return (
    <button className="btn ghost small" onClick={onOpen} title="Deliveries against this purchase">
      Deliveries
    </button>
  );
}
