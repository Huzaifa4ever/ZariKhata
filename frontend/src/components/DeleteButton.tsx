import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminMode } from '../admin/AdminMode';
import { IconTrash } from './icons';
import { Modal } from './Modal';
import { ErrorBanner } from './StatusBits';
import { ApiError } from '../api/client';
import * as api from '../api/resources';

/**
 * Shows nothing unless admin mode is on. When it is, it asks once - naming the
 * record in words the owner recognises, not an id - before deleting.
 */
export function DeleteButton({
  resource,
  id,
  label,
  description,
  invalidate,
}: {
  resource: Parameters<typeof api.adminDelete>[0];
  id: number;
  /** What the owner calls this thing, e.g. "Ali Hassan" or "Rent - Rs 2,000". */
  label: string;
  /** Extra line explaining the consequence. */
  description?: string;
  /** Query keys to refresh afterwards. */
  invalidate: string[];
}) {
  const { enabled } = useAdminMode();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.adminDelete(resource, id),
    onSuccess: () => {
      setOpen(false);
      for (const key of [...invalidate, 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete that.'),
  });

  if (!enabled) return null;

  return (
    <>
      <button
        className="btn ghost small icon-only"
        title={`Delete ${label}`}
        aria-label={`Delete ${label}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <IconTrash size={15} />
      </button>

      {open && (
        <Modal title="Delete for good?" onClose={() => setOpen(false)}>
          {error && <ErrorBanner message={error} />}
          <p>
            This permanently removes <strong>{label}</strong> and everything it posted to the books.
          </p>
          {description && <p className="muted">{description}</p>}
          <p className="muted">This cannot be undone.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn secondary" onClick={() => setOpen(false)}>
              Keep it
            </button>
            <button className="btn danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
