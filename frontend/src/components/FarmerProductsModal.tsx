import { useQuery } from '@tanstack/react-query';
import { Modal } from './Modal';
import { LoadingState, ErrorBanner, EmptyState } from './StatusBits';
import { formatMoney } from '../lib/format';
import * as api from '../api/resources';

/** Everything a farmer has bought, grouped by product, newest price first. */
export function FarmerProductsModal({
  farmer,
  onClose,
}: {
  farmer: { id: number; name: string };
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['farmer-products', farmer.id],
    queryFn: () => api.getFarmerProducts(farmer.id),
  });

  const rows = data?.rows ?? [];
  const spend = rows.reduce((sum, r) => sum + Number(r.totalValue), 0);

  return (
    <Modal title={`What ${farmer.name} buys`} onClose={onClose}>
      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load this farmer's purchases." />}
      {data && rows.length === 0 && (
        <EmptyState label={`${farmer.name} has not bought anything yet.`} />
      )}

      {rows.length > 0 && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">Different products</div>
              <div className="value">{rows.length}</div>
            </div>
            <div className="stat-card accent">
              <div className="label">Bought in total</div>
              <div className="value">{formatMoney(spend)}</div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Last paid</th>
                  <th className="text-right">Price now</th>
                  <th className="text-right">Total spent</th>
                  <th>Last bought</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const changed = Number(r.lastPrice) !== Number(r.currentPrice);
                  return (
                    <tr key={r.productId}>
                      <td>
                        {r.name}
                        <div className="cell-muted" style={{ fontSize: 11.5 }}>{r.sku}</div>
                      </td>
                      <td className="text-right">
                        {r.totalQuantity} {r.unit}
                        <div className="cell-muted" style={{ fontSize: 11.5 }}>{r.timesBought}x</div>
                      </td>
                      <td className="text-right">{formatMoney(r.lastPrice)}</td>
                      <td className={`text-right ${changed ? 'margin-thin' : ''}`}>
                        {formatMoney(r.currentPrice)}
                      </td>
                      <td className="text-right">{formatMoney(r.totalValue)}</td>
                      <td className="cell-muted">{r.lastBought}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="muted-3" style={{ fontSize: 12, marginTop: 10 }}>
            "Last paid" is what they were charged most recently. Where it differs from today's price, the
            current price is highlighted.
          </p>
        </>
      )}

      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
