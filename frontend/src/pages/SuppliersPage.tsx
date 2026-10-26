import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/resources';
import { formatMoney } from '../lib/format';
import { LoadingState, ErrorBanner, EmptyState } from '../components/StatusBits';
import { Modal } from '../components/Modal';
import { DeleteButton } from '../components/DeleteButton';
import { IconClose } from '../components/icons';
import { EditButton } from '../components/EditButton';
import { PartyDetail, type PartyRef } from '../components/PartyDetail';

export function SuppliersPage() {
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<PartyRef | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['suppliers', q], queryFn: () => api.listSuppliers(q || undefined) });

  return (
    <div>
      <div className="page-header">
        <h1>Companies &amp; Suppliers</h1>
        <button className="btn" onClick={() => setShowCreate(true)}>
          + Add supplier
        </button>
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorBanner message="Could not load suppliers." />}
      {data && data.length === 0 && <EmptyState label="No suppliers yet - add your first one." />}
      {data && data.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Phone</th>
                <th className="text-right">Outstanding payable</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button className="link-cell" onClick={() => setDetail({ id: s.id, kind: 'SUPPLIER', name: s.name })}>
                      {s.name}
                    </button>
                  </td>
                  <td>{s.type ?? '-'}</td>
                  <td>{s.phone ?? '-'}</td>
                  <td className="text-right">{formatMoney(s.outstandingBalance)}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <EditButton
                      title={s.name}
                      fields={[
                        { key: 'name', label: 'Name', required: true },
                        { key: 'type', label: 'Type' },
                        { key: 'phone', label: 'Phone' },
                        { key: 'address', label: 'Address' },
                      ]}
                      initial={{
                        name: s.name,
                        type: s.type ?? '',
                        phone: s.phone ?? '',
                        address: s.address ?? '',
                      }}
                      onSave={(v) => api.updateSupplier(s.id, v)}
                      invalidate={['suppliers']}
                    />
                    <DeleteButton
                      resource="suppliers"
                      id={s.id}
                      label={s.name}
                      description="Only possible while they have no purchases or payments - otherwise mark them inactive instead."
                      invalidate={['suppliers']}
                    />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <PartyDetail party={detail} onClose={() => setDetail(null)} />}

      {showCreate && (
        <CreateSupplierModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['suppliers'] });
          }}
        />
      )}
    </div>
  );
}

function CreateSupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', type: '', phone: '', address: '', openingBalance: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api.createSupplier({
        name: form.name,
        type: form.type || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not create supplier'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Modal title="Add supplier" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Type (company / local supplier)</label>
            <input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
            {mutation.isPending ? 'Saving…' : 'Save supplier'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * What this supplier sells us and what we make on it.
 *
 * Two prices side by side is the whole point: the shopkeeper's question is
 * "I buy this at 450 and sell at 500 - is that still true?", and that answer
 * lives in two different tables until something puts them next to each other.
 */
