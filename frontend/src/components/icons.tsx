/**
 * One icon set for the whole app: 24x24 grid, 1.75 stroke, round caps and
 * joins, drawn in `currentColor`. Keeping every icon on the same grid and
 * weight is what makes the navigation read as one designed set rather than
 * clip-art from five different places.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" />
  </Icon>
);

export const IconProducts = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
    <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" />
  </Icon>
);

export const IconFarmers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21v-7" />
    <path d="M12 14c0-3.3-2.5-6-5.5-6 0 3.3 2.5 6 5.5 6Z" />
    <path d="M12 14c0-3.9 2.9-7 6.5-7 0 3.9-2.9 7-6.5 7Z" />
  </Icon>
);

export const IconSuppliers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 21h18M5 21V6l7-3 7 3v15" />
    <path d="M9.5 10h.01M14.5 10h.01M9.5 14h.01M14.5 14h.01M10.5 21v-3h3v3" />
  </Icon>
);

export const IconSales = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4h2.2l1.5 10.5A2 2 0 0 0 9.7 16h7.9a2 2 0 0 0 2-1.6L21 8H7" />
    <circle cx="10" cy="20" r="1.2" />
    <circle cx="18" cy="20" r="1.2" />
  </Icon>
);

export const IconPurchases = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
    <path d="M12 12v9M12 12 3 7.5M12 12l9-4.5" />
    <path d="m7.5 5.2 9 4.6" />
  </Icon>
);

export const IconReceive = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M7 12h.01M17 12h.01" />
  </Icon>
);

export const IconPayOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10h18M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    <path d="M7 15h3" />
  </Icon>
);

export const IconExpenses = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v18M7.5 7.5h6a2.75 2.75 0 0 1 0 5.5h-3a2.75 2.75 0 0 0 0 5.5h6" />
  </Icon>
);

export const IconAccounts = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 9.5 12 4l9 5.5M4.5 9.5v8M19.5 9.5v8M3 20h18" />
    <path d="M8.5 11v6M15.5 11v6" />
  </Icon>
);

export const IconReports = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 16V11M12.5 16V7M17 16v-3" />
  </Icon>
);

export const IconTasks = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5h10M9 12h10M9 19h10" />
    <path d="m3.5 5 1.3 1.3L7 4M3.5 12l1.3 1.3L7 11M3.5 19l1.3 1.3L7 18" />
  </Icon>
);

export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.5 20a6 6 0 0 1 12 0" />
    <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6.1M18 14.4a6 6 0 0 1 3 5.6" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.2 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.6-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9Z" />
  </Icon>
);

export const IconLogout = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8" />
    <path d="m16 15 3-3-3-3M19 12H9" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

export const IconMonitor = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconBiller = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M7 8h10M7 12h6M7 16h4" />
  </Icon>
);

export const IconPrint = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 9V3h10v6" />
    <path d="M7 19H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M7 15h10v6H7z" />
  </Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />
  </Icon>
);

export const IconEdit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
);
