import { useEffect, type ReactNode } from 'react';
import { IconClose } from './icons';

/**
 * The one modal in the app - every dialog, form and popup goes through it.
 *
 * It closes on the × or a Cancel button, or when the thing it was opened to do
 * actually succeeds. Nothing else closes it: not a click on the backdrop, not
 * Escape. These are forms that took real typing to fill in at a shop counter,
 * often in a hurry, and losing a half-entered invoice to a misplaced click or
 * a stray key is far more costly than reaching for the ×.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** For a table that needs the room - a cash book, a statement. */
  wide?: boolean;
}) {
  // The backdrop is the scroller while it is open, so let the page behind
  // stay put instead of scrolling away under it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="page-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost small" onClick={onClose} type="button" aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
