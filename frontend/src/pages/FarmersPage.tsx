import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney, describeBalance } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import { DeleteButton } from '../components/DeleteButton';
import { EditButton } from '../components/EditButton';

export function FarmersPage() {
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['farmers', q], queryFn: () => api.listFarmers(q || undefined) });

  return (
    <div>
      <div className="page-header">
        <h1>Farmers</h1>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + Add farmer
        </button>
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search name, phone, code…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load farmers." />}
      {data && data.length === 0 && <EmptyState label="No farmers yet - add your first one." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Village</th>
                <th className="text-right">Outstanding balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.phone ?? '-'}</td>
                  <td>{f.village ?? '-'}</td>
                  <td className="text-right">
                    {(() => {
                      const b = describeBalance(f.outstandingBalance);
                      return (
                        <span className={b.tone === 'credit' ? 'balance-credit' : undefined}>
                          {b.tone === 'credit' ? b.text : formatMoney(f.outstandingBalance)}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                    <EditButton
                      title={f.name}
                      fields={[
                        { key: 'name', label: 'Name', required: true },
                        { key: 'phone', label: 'Phone' },
                        { key: 'village', label: 'Village' },
                        { key: 'cropInfo', label: 'Crops' },
                      ]}
                      initial={{
                        name: f.name,
                        phone: f.phone ?? '',
                        village: f.village ?? '',
                        cropInfo: f.cropInfo ?? '',
                      }}
                      onSave={(v) => api.updateFarmer(f.id, v)}
                      invalidate={['farmers']}
                    />
                    <DeleteButton
                      resource="farmers"
                      id={f.id}
                      label={f.name}
                      description="Only possible while they have no invoices or payments - otherwise mark them inactive instead."
                      invalidate={['farmers']}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateFarmerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['farmers'] });
          }}
        />
      )}
    </div>
  );
}

function CreateFarmerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', village: '', cropInfo: '', openingBalance: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api.createFarmer({
        name: form.name,
        phone: form.phone || undefined,
        village: form.village || undefined,
        cropInfo: form.cropInfo || undefined,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create farmer'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Modal title="Add farmer" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Village</label>
            <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} />
          </div>
          <div className="field">
            <label>Crop / farm info</label>
            <input value={form.cropInfo} onChange={(e) => setForm({ ...form, cropInfo: e.target.value })} />
          </div>
          <div className="field">
            <label>Opening balance</label>
            <input
              type="number"
              step="0.01"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
            />
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save farmer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
