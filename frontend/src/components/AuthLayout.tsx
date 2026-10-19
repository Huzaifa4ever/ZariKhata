import type { ReactNode } from 'react';
import { Logo, LogoLockup } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const POINTS = [
  'Stock, batches and expiry dates, tracked per product',
  'Farmer credit and supplier payables, always reconciled',
  'Everything stays on this computer - no internet needed',
];

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" opacity=".4" />
      <path
        d="m8 12.3 2.7 2.7L16 9.7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The split brand-panel shell shared by the login and first-run setup screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <section className="auth-brand">
        <LogoLockup size={44} tagline />
        <div className="auth-pitch">
          <h2>Your shop, in order.</h2>
          <p>
            ZariKhata keeps the stock register, the farmers' khata and the company accounts in one
            place - so the numbers agree at the end of every day.
          </p>
          <ul className="auth-points">
            {POINTS.map((point) => (
              <li key={point}>
                <Check />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-foot">Runs offline on this PC · Your data never leaves it</div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-mark">
            <Logo size={40} />
          </div>
          {children}
          <div className="auth-note">
            <ThemeToggle />
            <span>Appearance - light, dark, or match Windows.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
