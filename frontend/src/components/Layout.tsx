import { Fragment } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { useAdminMode } from '../admin/AdminMode';
import {
  IconAccounts,
  IconDashboard,
  IconExpenses,
  IconFarmers,
  IconLogout,
  IconProducts,
  IconPurchases,
  IconReports,
  IconSalaries,
  IconSales,
  IconSettings,
  IconSuppliers,
  IconTasks,
  IconUsers,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof IconDashboard;
  ownerOnly?: boolean;
}

/* Grouped the way a shopkeeper actually thinks about the day: what's
   happening now, who owes whom, where the money sits, and admin. */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', Icon: IconDashboard }],
  },
  {
    label: 'Day to day',
    items: [
      { to: '/sales', label: 'Sales', Icon: IconSales },
      { to: '/purchases', label: 'Purchases', Icon: IconPurchases },
      { to: '/products', label: 'Products & Stock', Icon: IconProducts },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/farmers', label: 'Farmers', Icon: IconFarmers },
      { to: '/suppliers', label: 'Companies & Suppliers', Icon: IconSuppliers },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/expenses', label: 'Expenses', Icon: IconExpenses },
      { to: '/accounts', label: 'Accounts', Icon: IconAccounts },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/reports', label: 'Reports', Icon: IconReports },
      { to: '/tasks', label: 'Tasks & Reminders', Icon: IconTasks },
      { to: '/users', label: 'Users', Icon: IconUsers, ownerOnly: true },
      { to: '/salaries', label: 'Employee Salaries', Icon: IconSalaries, ownerOnly: true },
      { to: '/settings', label: 'Settings', Icon: IconSettings, ownerOnly: true },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Longest matching prefix wins, so /farmer-payments doesn't resolve to /.
  const current = ALL_ITEMS.filter((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to))).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const visible = (item: NavItem) => !item.ownerOnly || user?.role === 'OWNER';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={28} />
          <span className="sidebar-brand-text">
            Zari<span>Khata</span>
          </span>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <Fragment key={group.label}>
                <div className="sidebar-group-label">{group.label}</div>
                {items.map(({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                  >
                    <Icon size={17} />
                    {label}
                  </NavLink>
                ))}
              </Fragment>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{initials(user?.name)}</div>
            <div className="user-chip-meta">
              <div className="user-chip-name">{user?.name}</div>
              <div className="user-chip-role">{user?.role}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">{current?.label ?? 'ZariKhata'}</div>
          <div className="topbar-actions">
            <AdminModeToggle />
            <ThemeToggle />
            <button className="btn ghost small" onClick={handleLogout}>
              <IconLogout size={15} />
              Log out
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Admin mode, within reach of the screen you need it on.
 *
 * It lived only in Settings, which meant correcting a typo on an invoice was:
 * leave the page, open Settings, switch on, navigate back, find the row again.
 * That is enough friction that a wrong number stays wrong. The switch is still
 * owner-only and still a deliberate act - it is just no longer three screens
 * away from the thing it applies to.
 */
function AdminModeToggle() {
  const { enabled, available, setEnabled } = useAdminMode();
  if (!available) return null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className={`btn ghost small admin-pill${enabled ? ' on' : ''}`}
      onClick={() => setEnabled(!enabled)}
      title={
        enabled
          ? 'Edit and delete buttons are showing. Click to hide them again.'
          : 'Show edit and delete buttons on records.'
      }
    >
      <span className="admin-dot" aria-hidden="true" />
      {enabled ? 'Admin on' : 'Admin'}
    </button>
  );
}
