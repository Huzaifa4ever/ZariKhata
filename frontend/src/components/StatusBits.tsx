import type { DocumentStatus } from '../api/types';
import { IconAlert } from './icons';
import { LogoLockup } from './Logo';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty-state">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert">
      <IconAlert size={16} />
      <span>{message}</span>
    </div>
  );
}

/** Shown while the app waits for the local backend to answer at startup. */
export function BootScreen({ label }: { label: string }) {
  return (
    <div className="boot-screen">
      <LogoLockup size={48} stacked tagline />
      <div>{label}</div>
    </div>
  );
}

const STATUS_CLASS: Record<DocumentStatus, string> = {
  PAID: 'paid',
  PARTIALLY_PAID: 'partial',
  UNPAID: 'unpaid',
  VOID: 'void',
};

const STATUS_LABEL: Record<DocumentStatus, string> = {
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partial',
  UNPAID: 'Unpaid',
  VOID: 'Void',
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}
