import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { BootScreen } from './components/StatusBits';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import * as api from './api/resources';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { FarmersPage } from './pages/FarmersPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { SalesPage } from './pages/SalesPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { AccountsPage } from './pages/AccountsPage';
import { ReportsPage } from './pages/ReportsPage';
import { TasksPage } from './pages/TasksPage';
import { UsersPage } from './pages/UsersPage';
import { SalariesPage } from './pages/SalariesPage';
import { SettingsPage } from './pages/SettingsPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <BootScreen label="Signing you in…" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function useSetupGate() {
  const [state, setState] = useState<'checking' | 'needsSetup' | 'ready'>('checking');

  useEffect(() => {
    api
      .getSetupStatus()
      .then((r) => setState(r.needsSetup ? 'needsSetup' : 'ready'))
      // If the backend isn't reachable yet (e.g. the local backend is still
      // starting up), fall through to the normal app - its own loading/error
      // states already handle "can't reach the server".
      .catch(() => setState('ready'));
  }, []);

  return state;
}

export default function App() {
  const setupState = useSetupGate();

  if (setupState === 'checking') return <BootScreen label="Starting up…" />;
  if (setupState === 'needsSetup') return <SetupPage onDone={() => window.location.reload()} />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="farmers" element={<FarmersPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="salaries" element={<SalariesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      {/* Merged away: billing now prints from a real sale, and payments are
          taken inside the farmer/supplier record. Old links still resolve. */}
      <Route path="/biller" element={<Navigate to="/sales" replace />} />
      <Route path="/farmer-payments" element={<Navigate to="/farmers" replace />} />
      <Route path="/supplier-payments" element={<Navigate to="/suppliers" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
