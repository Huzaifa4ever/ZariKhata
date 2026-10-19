/**
 * ZariKhata brand marks.
 *
 * The mark is a wide leaf (agro) whose counterform holds a Z monogram that
 * also reads as a ledger zigzag (khata). It is drawn on a 32x32 grid so the
 * same path data serves the 16px sidebar glyph and the 512px app icon.
 *
 * Three forms, all from the same geometry:
 *   <LogoGlyph/>   bare mark in currentColor - inline, sidebars, favicons
 *   <Logo/>        mark on the gradient brand tile - app icon, hero, login
 *   <LogoLockup/>  tile + wordmark (+ optional tagline) - the full lockup
 */

// The leaf: base at bottom-left, tip at top-right, built from two mirrored arcs.
export const LEAF_PATH = 'M4.5 27.5 C4.5 14 14 4.5 27.5 4.5 C27.5 18 18 27.5 4.5 27.5 Z';
// The Z sits in the leaf's optical centre, its diagonal running against the
// leaf's own axis so the two forms brace each other rather than blur together.
export const Z_PATH = 'M11 11.5 H21.4 L11 20.9 H21.4';

interface GlyphProps {
  size?: number;
  /** Colour of the Z counterform. Defaults to the page background so the Z reads as a cut-out. */
  counterColor?: string;
  className?: string;
}

/** The bare mark: leaf in `currentColor`, Z knocked out of it. */
export function LogoGlyph({ size = 28, counterColor = 'var(--brand-counter)', className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="ZariKhata"
    >
      <path d={LEAF_PATH} fill="currentColor" />
      <path
        d={Z_PATH}
        fill="none"
        stroke={counterColor}
        strokeWidth="2.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface LogoProps {
  size?: number;
  /** Corner radius as a fraction of size. 0.27 is the squircle-ish default. */
  radius?: number;
  className?: string;
}

let tileId = 0;

/** The mark on its gradient brand tile - the app-icon form. */
export function Logo({ size = 40, radius = 0.27, className }: LogoProps) {
  // Gradients need document-unique ids or multiple logos on one page collide.
  const id = `zk-tile-${(tileId += 1)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="ZariKhata"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-tile-from)" />
          <stop offset="1" stopColor="var(--brand-tile-to)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={64 * radius} fill={`url(#${id})`} />
      <g transform="translate(16,16)">
        <path d={LEAF_PATH} fill="#fff" />
        <path
          d={Z_PATH}
          fill="none"
          stroke="var(--brand-tile-counter)"
          strokeWidth="2.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

interface LockupProps {
  /** Tile size; the wordmark scales from it. */
  size?: number;
  tagline?: boolean;
  /** Stack the wordmark under the tile instead of beside it. */
  stacked?: boolean;
}

export function LogoLockup({ size = 42, tagline = false, stacked = false }: LockupProps) {
  return (
    <div className={`logo-lockup${stacked ? ' stacked' : ''}`}>
      <Logo size={size} />
      <div className="logo-lockup-text">
        <div className="logo-wordmark" style={{ fontSize: size * 0.6 }}>
          Zari<span>Khata</span>
        </div>
        {tagline && <div className="logo-tagline">Agro Business · Accounts · Stock</div>}
      </div>
    </div>
  );
}
