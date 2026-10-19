import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminMode } from '../admin/AdminMode';
import { IconEdit } from './icons';
import { Modal } from './Modal';
import { ErrorBanner } from './StatusBits';
import { ApiError } from '../api/client';

export interface EditField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: Array<{ value: string | number; label: string }>;
  hint?: string;
  required?: boolean;
  step?: string;
}

/**
 * The edit half of admin mode. Hidden unless the switch is on, same as
 * DeleteButton - correcting a typo in a farmer's phone number is harmless,
 * but changing an amount after the fact moves money in the books, so it sits
 * behind the same deliberate toggle.
 */
export function EditButton({
  title,
  fields,
  initial,
  onSave,
  invalidate,
}: {
  title: string;
  fields: EditField[];
  initial: Record<string, string>;
  onSave: (values: Record<string, string>) => Promise<unknown>;
  invalidate: string[];
}) {
  const { enabled } = useAdminMode();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => onSave(values),
    onSuccess: () => {
      setOpen(false);
      for (const key of [...invalidate, 'dashboard']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save those changes.'),
  });

  if (!enabled) return null;

  return (
    <>
      <button
        className="btn ghost small icon-only"
        title={`Edit ${title}`}
        aria-label={`Edit ${title}`}
        onClick={() => {
          setValues(initial);
          setError(null);
          setOpen(true);
        }}
      >
        <IconEdit size={15} />
      </button>

      {open && (
        <Modal title={`Edit ${title}`} onClose={() => setOpen(false)}>
          {error && <ErrorBanner message={error} />}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate();
            }}
          >
            <div className="form-grid">
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`edit-${f.key}`}>{f.label}</label>
                  {f.type === 'select' ? (
                    <select
                      id={`edit-${f.key}`}
                      value={values[f.key] ?? ''}
                      required={f.required}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    >
                      <option value="">-</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`edit-${f.key}`}
                      type={f.type ?? 'text'}
                      step={f.step}
                      required={f.required}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  )}
                  {f.hint && <span className="hint">{f.hint}</span>}
                </div>
              ))}
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
