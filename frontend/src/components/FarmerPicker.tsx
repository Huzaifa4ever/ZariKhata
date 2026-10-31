/**
 * Picking a farmer by typing their name.
 *
 * Products got a proper search box months ago; farmers were still a plain
 * <select>, which is the same scrolling problem with a longer list and names
 * that are easy to misspell. This matches ProductPicker's behaviour exactly -
 * case, spaces and punctuation ignored, every typed word has to appear
 * somewhere - so the counter works the same way whichever field it is in.
 *
 * It can also create a farmer without leaving the invoice. That is not a
 * convenience: a sale on credit has to be against a named account or the debt
 * is invisible to every receivables figure in the system, so the moment a
 * walk-in asks for credit, the shopkeeper needs a farmer *here*, not three
 * screens away with a half-typed invoice abandoned behind them.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Farmer } from '../api/types';
import * as api from '../api/resources';
import { ApiError } from '../api/client';
import { formatMoney } from '../lib/format';
import { IconClose, IconPlus, IconSearch } from './icons';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function matches(farmer: Farmer, query: string): boolean {
  const haystack = normalize(
    `${farmer.name} ${farmer.farmerCode ?? ''} ${farmer.village ?? ''} ${farmer.phone ?? ''}`,
  );
  return query
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function balanceNote(farmer: Farmer): string {
  const owed = Number(farmer.outstandingBalance ?? 0);
  const where = farmer.village ? `${farmer.village} · ` : '';
  if (Math.abs(owed) < 0.005) return `${where}settled up`;
  if (owed > 0) return `${where}owes ${formatMoney(owed)}`;
  return `${where}${formatMoney(-owed)} in credit`;
}

export function FarmerPicker({
  farmers,
  value,
  onChange,
  allowWalkIn = true,
  allowCreate = true,
  required = false,
}: {
  farmers: Farmer[];
  value: number | '';
  onChange: (farmer: Farmer | null) => void;
  /** Off on screens where a nameless customer makes no sense, like a payment. */
  allowWalkIn?: boolean;
  allowCreate?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = farmers.find((f) => f.id === value) ?? null;

  const results = useMemo(() => {
    const list = query.trim() ? farmers.filter((f) => matches(f, query)) : farmers;
    return list.slice(0, 50);
  }, [farmers, query]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(farmer: Farmer | null) {
    onChange(farmer);
    setQuery('');
    setOpen(false);
    setCreating(false);
  }

  const canCreate = allowCreate && query.trim().length > 1;

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => {
        const count = results.length;
        if (count === 0) return 0;
        return event.key === 'ArrowDown' ? (i + 1) % count : (i - 1 + count) % count;
      });
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (results[active]) choose(results[active]);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  const placeholder = allowWalkIn ? 'Walk-in customer (no account)' : 'Search by name, village or code…';

  return (
    <div className={`combo${open ? ' open' : ''}`} ref={wrapRef}>
      <IconSearch size={15} className="combo-icon" />
      <input
        ref={inputRef}
        className="combo-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={selected ? selected.name : placeholder}
        value={open ? query : selected?.name ?? ''}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {selected && !open && (
        <button
          type="button"
          className="combo-clear"
          aria-label={`Clear ${selected.name}`}
          onClick={() => {
            choose(null);
            inputRef.current?.focus();
          }}
        >
          <IconClose size={13} />
        </button>
      )}

      <input
        className="combo-validity"
        tabIndex={-1}
        aria-hidden="true"
        required={required}
        value={value === '' ? '' : String(value)}
        onChange={() => undefined}
        onFocus={() => inputRef.current?.focus()}
      />

      {open && creating && (
        <NewFarmerInline
          name={query.trim()}
          onCancel={() => setCreating(false)}
          onCreated={(f) => choose(f)}
        />
      )}

      {open && !creating && (
        <div className="combo-list" id={listId} role="listbox" ref={listRef}>
          {allowWalkIn && !query.trim() && (
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className="combo-option"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(null);
              }}
            >
              <span className="combo-option-name">Walk-in customer</span>
              <span className="combo-option-meta">no account · must pay in full</span>
            </button>
          )}

          {results.length === 0 && (
            <div className="combo-empty">
              {farmers.length === 0 ? 'No farmers yet.' : `Nothing matches "${query}".`}
            </div>
          )}

          {results.map((farmer, i) => (
            <button
              type="button"
              key={farmer.id}
              role="option"
              aria-selected={farmer.id === value}
              className={`combo-option${i === active ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(farmer);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="combo-option-name">{farmer.name}</span>
              <span className="combo-option-meta">{balanceNote(farmer)}</span>
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              className="combo-create"
              onMouseDown={(e) => {
                e.preventDefault();
                setCreating(true);
              }}
            >
              <IconPlus size={14} />
              Add "{query.trim()}" as a new farmer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NewFarmerInline({
  name,
  onCancel,
  onCreated,
}: {
  name: string;
  onCancel: () => void;
  onCreated: (farmer: Farmer) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name, phone: '', village: '' });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.createFarmer({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        village: form.village.trim() || undefined,
      }),
    onSuccess: (farmer) => {
      qc.invalidateQueries({ queryKey: ['farmers'] });
      onCreated(farmer as Farmer);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add that farmer.'),
  });

  return (
    <div className="combo-list combo-create-panel">
      <div className="combo-create-head">New farmer</div>
      {error && <div className="combo-create-error">{error}</div>}
      <div className="combo-create-grid">
        <label>
          <span>Name</span>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            value={form.phone}
            placeholder="optional"
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        </label>
        <label>
          <span>Village</span>
          <input
            value={form.village}
            placeholder="optional"
            onChange={(e) => setForm({ ...form, village: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        </label>
      </div>
      <p className="combo-create-note">
        Opens a khata for them straight away, so this invoice can go on credit.
      </p>
      <div className="combo-create-actions">
        <button type="button" className="btn secondary small" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn small"
          disabled={save.isPending || !form.name.trim()}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
          {save.isPending ? 'Adding…' : 'Add and use'}
        </button>
      </div>
    </div>
  );
}
