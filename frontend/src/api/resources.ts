import { apiRequest } from './client';
import type {
  Account,
  Business,
  DashboardSnapshot,
  Expense,
  ExpenseCategory,
  Farmer,
  Product,
  Purchase,
  Sale,
  Supplier,
  Task,
  User,
} from './types';

// --- auth ---
export const login = (username: string, password: string) =>
  apiRequest<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: { username, password } });
export const logout = () => apiRequest('/api/auth/logout', { method: 'POST' });
export const me = () => apiRequest<User>('/api/auth/me');

// --- business ---
export const getBusiness = () => apiRequest<Business>('/api/business');
export const updateBusiness = (data: Partial<Business>) =>
  apiRequest<Business>('/api/business', { method: 'PATCH', body: data });

// --- users ---
export const listUsers = () => apiRequest<User[]>('/api/users');
export const createUser = (data: { name: string; username: string; password: string; role?: string }) =>
  apiRequest<User>('/api/users', { method: 'POST', body: data });
export const updateUser = (id: number, data: Record<string, unknown>) =>
  apiRequest<User>(`/api/users/${id}`, { method: 'PATCH', body: data });
export const getMyProfile = () => apiRequest<User>('/api/users/me');
export const updateMyProfile = (data: {
  name?: string;
  username?: string;
  email?: string | null;
  currentPassword?: string;
  newPassword?: string;
}) => apiRequest<{ user: User; mustSignInAgain: boolean }>('/api/users/me', { method: 'PATCH', body: data });

// --- suppliers ---
export const listSuppliers = (q?: string) => apiRequest<Supplier[]>('/api/suppliers', { query: { q } });
export const getSupplier = (id: number) => apiRequest<Supplier>(`/api/suppliers/${id}`);
export const createSupplier = (data: Record<string, unknown>) =>
  apiRequest<Supplier>('/api/suppliers', { method: 'POST', body: data });
export const updateSupplier = (id: number, data: Record<string, unknown>) =>
  apiRequest<Supplier>(`/api/suppliers/${id}`, { method: 'PATCH', body: data });
export const getSupplierLedger = (id: number) => apiRequest(`/api/suppliers/${id}/ledger`);
export interface SupplierCatalogueRow {
  productId: number; name: string; sku: string; unit: string;
  lastCost: string; sellingPrice: string; profit: string; marginPercent: string;
  lastOrdered: string; lastInvoice: string; totalQuantity: string; timesOrdered: number;
}
export const getSupplierCatalogue = (id: number) =>
  apiRequest<{ count: number; rows: SupplierCatalogueRow[] }>(`/api/suppliers/${id}/catalogue`);

// --- farmers ---
export const listFarmers = (q?: string) => apiRequest<Farmer[]>('/api/farmers', { query: { q } });
export const getFarmer = (id: number) => apiRequest<Farmer>(`/api/farmers/${id}`);
export const createFarmer = (data: Record<string, unknown>) =>
  apiRequest<Farmer>('/api/farmers', { method: 'POST', body: data });
export const updateFarmer = (id: number, data: Record<string, unknown>) =>
  apiRequest<Farmer>(`/api/farmers/${id}`, { method: 'PATCH', body: data });
export const getFarmerLedger = (id: number) => apiRequest(`/api/farmers/${id}/ledger`);
export interface FarmerProductRow {
  productId: number; name: string; sku: string; unit: string;
  lastPrice: string; currentPrice: string; lastBought: string; lastInvoice: string;
  totalQuantity: string; totalValue: string; timesBought: number;
}
export const getFarmerProducts = (id: number) =>
  apiRequest<{ farmer: { name: string }; count: number; rows: FarmerProductRow[] }>(
    `/api/farmers/${id}/products`,
  );

// --- categories ---
export const listCategories = () => apiRequest<{ id: number; name: string }[]>('/api/categories');
export const createCategory = (name: string) =>
  apiRequest<{ id: number; name: string }>('/api/categories', { method: 'POST', body: { name } });

// --- products ---
export interface ProductFilters {
  q?: string;
  categoryId?: number;
  supplierId?: number;
  activeOnly?: boolean;
  lowStock?: boolean;
  outOfStock?: boolean;
  expiringSoon?: boolean;
  expired?: boolean;
}
export const listProducts = (filters: ProductFilters = {}) =>
  apiRequest<Product[]>('/api/products', { query: filters as Record<string, string | number | boolean | undefined> });
export const getProduct = (id: number) => apiRequest<Product>(`/api/products/${id}`);
export const createProduct = (data: Record<string, unknown>) =>
  apiRequest<Product>('/api/products', { method: 'POST', body: data });
export const updateProduct = (id: number, data: Record<string, unknown>) =>
  apiRequest<Product>(`/api/products/${id}`, { method: 'PATCH', body: data });
export const adjustStock = (
  id: number,
  data: { quantityChange: number; reason?: string; batchId?: number; expiryDate?: string; batchNumber?: string },
) =>
  apiRequest(`/api/products/${id}/adjust-stock`, { method: 'POST', body: data });

// --- purchases ---
export const listPurchases = (filters: Record<string, string | number | undefined> = {}) =>
  apiRequest<Purchase[]>('/api/purchases', { query: filters });
export const getPurchase = (id: number) => apiRequest<Purchase>(`/api/purchases/${id}`);
export const createPurchase = (data: Record<string, unknown>) =>
  apiRequest<Purchase>('/api/purchases', { method: 'POST', body: data });
export const createPurchaseReturn = (data: Record<string, unknown>) =>
  apiRequest('/api/purchase-returns', { method: 'POST', body: data });

// --- sales ---
export const listSales = (filters: Record<string, string | number | undefined> = {}) =>
  apiRequest<Sale[]>('/api/sales', { query: filters });
export const getSale = (id: number) => apiRequest<Sale>(`/api/sales/${id}`);
export const createSale = (data: Record<string, unknown>) =>
  apiRequest<Sale>('/api/sales', { method: 'POST', body: data });
export const createSaleReturn = (data: Record<string, unknown>) =>
  apiRequest('/api/sale-returns', { method: 'POST', body: data });

// --- payments ---
export const listFarmerPayments = (farmerId?: number) =>
  apiRequest('/api/farmer-payments', { query: { farmerId } });
export const createFarmerPayment = (data: Record<string, unknown>) =>
  apiRequest('/api/farmer-payments', { method: 'POST', body: data });
export const listSupplierPayments = (supplierId?: number) =>
  apiRequest('/api/supplier-payments', { query: { supplierId } });
export const createSupplierPayment = (data: Record<string, unknown>) =>
  apiRequest('/api/supplier-payments', { method: 'POST', body: data });

// --- expenses ---
export const listExpenseCategories = () => apiRequest<ExpenseCategory[]>('/api/expenses/categories');
export const createExpenseCategory = (name: string) =>
  apiRequest<ExpenseCategory>('/api/expenses/categories', { method: 'POST', body: { name } });
export const listExpenses = (filters: Record<string, string | number | undefined> = {}) =>
  apiRequest<Expense[]>('/api/expenses', { query: filters });
export const createExpense = (data: Record<string, unknown>) =>
  apiRequest<Expense>('/api/expenses', { method: 'POST', body: data });

// --- accounts ---
export const listAccounts = () => apiRequest<Account[]>('/api/accounts');
export const createAccount = (data: { name: string; type: string; openingBalance?: number }) =>
  apiRequest<Account>('/api/accounts', { method: 'POST', body: data });
export const getAccountStatement = (id: number, params: { from?: string; to?: string } = {}) =>
  apiRequest(`/api/accounts/${id}/statement`, { query: params });

// --- tasks ---
export const listTasks = (filters: Record<string, string | number | undefined> = {}) =>
  apiRequest<Task[]>('/api/tasks', { query: filters });
export const createTask = (data: Record<string, unknown>) =>
  apiRequest<Task>('/api/tasks', { method: 'POST', body: data });
export const updateTask = (id: number, data: Record<string, unknown>) =>
  apiRequest<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: data });

// --- reports ---
export const getReport = (key: string, params: Record<string, string | number | undefined> = {}) =>
  apiRequest(`/api/reports/${key}`, { query: params });

export interface FarmerStatement {
  farmer: { id: number; name: string; phone?: string | null; village?: string | null };
  summary: {
    openingBalance: string; charged: string; paid: string; closingBalance: string;
    invoiceCount: number; paymentCount: number;
  };
  sales: Array<Record<string, string | number>>;
  payments: Array<Record<string, string | number>>;
  entries: Array<{ date: string; description: string; debit: string; credit: string; balance: string }>;
}
export const getFarmerStatement = (farmerId: number, params: { from?: string; to?: string } = {}) =>
  apiRequest<FarmerStatement>(`/api/reports/farmer-statement/${farmerId}`, { query: params });

// --- admin mode (owner-only destructive actions) ---
export type AdminResource =
  | 'expenses' | 'sales' | 'purchases'
  | 'farmer-payments' | 'supplier-payments'
  | 'farmers' | 'suppliers' | 'products';
export const adminUpdateExpense = (id: number, data: Record<string, unknown>) =>
  apiRequest(`/api/admin/expenses/${id}`, { method: 'PATCH', body: data });
export const adminUpdateSale = (id: number, data: Record<string, unknown>) =>
  apiRequest(`/api/admin/sales/${id}`, { method: 'PATCH', body: data });
export const adminUpdatePurchase = (id: number, data: Record<string, unknown>) =>
  apiRequest(`/api/admin/purchases/${id}`, { method: 'PATCH', body: data });
export const adminDelete = (resource: AdminResource, id: number) =>
  apiRequest<{ deleted: boolean }>(`/api/admin/${resource}/${id}`, { method: 'DELETE' });

// --- dashboard ---
export const getDashboard = () => apiRequest<DashboardSnapshot>('/api/dashboard');
export interface TrendPoint { date: string; sales: string; expenses: string }
export const getDashboardTrend = (params: { from: string; to: string; bucket?: 'day' | 'month' }) =>
  apiRequest<{ bucket: 'day' | 'month'; points: TrendPoint[] }>('/api/dashboard/trend', { query: params });

// --- first-run setup ---
export const getSetupStatus = () => apiRequest<{ needsSetup: boolean }>('/api/setup/status');
export const performSetup = (data: { shopName: string; ownerName: string; username: string; password: string }) =>
  apiRequest<{ token: string; user: User }>('/api/setup', { method: 'POST', body: data });
