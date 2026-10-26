/**
 * Picking a product by typing its name.
 *
 * A plain dropdown makes the shopkeeper scroll a list of hundreds to find one
 * bottle, and only jumps to what they type if they get the first letters
 * exactly right. This filters as they type and ignores case, spacing and
 * punctuation, so "weed 500", "WEEDKILL" and "500 ml" all find
 * "Demo Super Weedkill 500ml".
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Product } from '../api/types';
import { IconClose, IconSearch } from './icons';

/** Case, spaces and punctuation all dropped - nobody types a SKU consistently. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Every word typed must appear somewhere, in any order: "500 weed" works too. */
function matches(product: Product, query: string): boolean {
  const haystack = normalize(`${product.name} ${product.sku} ${product.brand ?? ''}`);
  return query
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function stockLabel(product: Product): { text: string; out: boolean } {
  const stock = Number(product.currentStock ?? 0);
  if (!product.currentStock) return { text: product.sku, out: false };
  if (stock <= 0) return { text: `${product.sku} - out of stock`, out: true };
  return { text: `${product.sku} - ${stock} ${product.unit} in stock`, out: false };
}

export function ProductPicker({
  products,
  value,
  onChange,
  required = false,
  placeholder = 'Search by name or code...',
}: {
  products: Product[];
  value: number | '';
  /** Null when the choice is cleared. */
  onChange: (product: Product | null) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = products.find((p) => p.id === value) ?? null;

  const results = useMemo(() => {
    const list = query.trim() ? products.filter((p) => matches(p, query)) : products;
    // A long list is slow to render and nobody scrolls past the first few -
    // typing another letter is quicker than scrolling.
    return list.slice(0, 50);
  }, [products, query]);

  useEffect(() => setActive(0), [query, open]);

  // Keep the keyboard-highlighted row visible.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Clicking anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(product: Product) {
    onChange(product);
    setQuery('');
    setOpen(false);
  }

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
      // Never let Enter reach the form and submit a half-filled invoice.
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
            onChange(null);
            setQuery('');
            inputRef.current?.focus();
          }}
        >
          <IconClose size={13} />
        </button>
      )}

      {/* Carries the form's "required" check, since the real input holds a
          search box's text rather than the chosen product. */}
      <input
        className="combo-validity"
        tabIndex={-1}
        aria-hidden="true"
        required={required}
        value={value === '' ? '' : String(value)}
        onChange={() => undefined}
        onFocus={() => inputRef.current?.focus()}
      />

      {open && (
        <div className="combo-list" id={listId} role="listbox" ref={listRef}>
          {results.length === 0 && (
            <div className="combo-empty">
              {products.length === 0 ? 'No products yet.' : `Nothing matches "${query}".`}
            </div>
          )}
          {results.map((product, i) => {
            const meta = stockLabel(product);
            return (
              <button
                type="button"
                key={product.id}
                role="option"
                aria-selected={product.id === value}
                className={`combo-option${i === active ? ' active' : ''}`}
                // mousedown, not click: the input blurs first on a click and
                // the list would be gone before the click landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(product);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="combo-option-name">{product.name}</span>
                <span className={`combo-option-meta${meta.out ? ' out' : ''}`}>{meta.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
