export interface User {
  id: number;
  name: string;
  username: string;
  monthlySalary?: string | null;
  email?: string | null;
  role: 'OWNER' | 'EMPLOYEE';
  isActive?: boolean;
  businessId?: number;
}

export interface Business {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  currencyCode: string;
  currencySymbol: string;
  salesInvoicePrefix: string;
  purchaseInvoicePrefix: string;
  lowStockDefaultAlert: number;
}

export interface Supplier {
  id: number;
  name: string;
  type?: string | null;
  phone?: string | null;
  address?: string | null;
  openingBalance: string;
  outstandingBalance?: string;
  isActive: boolean;
  notes?: string | null;
}

export interface Farmer {
  id: number;
  name: string;
  farmerCode?: string | null;
  phone?: string | null;
  village?: string | null;
  cropInfo?: string | null;
  openingBalance: string;
  outstandingBalance?: string;
  isActive: boolean;
  notes?: string | null;
}

export interface Category {
  id: number;
  name: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  categoryId?: number | null;
  category?: Category | null;
  brand?: string | null;
  unit: string;
  lastPurchaseCost: string;
  sellingPrice: string;
  minStockThreshold: string;
  preferredSupplierId?: number | null;
  isActive: boolean;
  notes?: string | null;
  imageData?: string | null;
  createdByUser?: { name: string } | null;
  currentStock?: string;
  isLowStock?: boolean;
  isOutOfStock?: boolean;
  hasExpired?: boolean;
  hasExpiringSoon?: boolean;
  batches?: ProductBatch[];
}

export interface ProductBatch {
  id: number;
  batchNumber?: string | null;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  purchaseCost: string;
  quantityReceived: string;
  quantityRemaining: string;
}

export type DocumentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

/** Where an order is between being placed and standing on the shelf. */
export type ArrivalStatus = 'PENDING' | 'PARTIAL' | 'RECEIVED';

export interface Purchase {
  id: number;
  supplierId: number;
  supplier?: Supplier;
  invoiceNumber: string;
  supplierInvoiceNumber?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  subtotal: string;
  discount: string;
  total: string;
  amountPaid: string;
  balance: string;
  status: DocumentStatus;
  /** Payment status and arrival status are independent: money and goods move on different days. */
  arrivalStatus: ArrivalStatus;
  expectedArrivalDate?: string | null;
  notes?: string | null;
  items?: PurchaseItem[];
}

export interface PurchaseItem {
  id: number;
  productId: number;
  product?: Product;
  batchId?: number | null;
  quantity: string;
  unitCost: string;
  discount: string;
  lineTotal: string;
  /** Arrived and accepted onto the shelf. */
  quantityReceived: string;
  /** Arrived damaged or short; credited back, never stocked. */
  quantityRejected: string;
  /** Written off when the order was closed. */
  quantityCancelled: string;
}

export interface Sale {
  id: number;
  /** Null for a walk-in counter sale - no credit account is involved. */
  farmerId: number | null;
  farmer?: Farmer | null;
  customerName?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  subtotal: string;
  discount: string;
  total: string;
  amountPaid: string;
  balance: string;
  status: DocumentStatus;
  notes?: string | null;
  items?: SaleItem[];
}

export interface SaleItem {
  id: number;
  productId: number;
  product?: Product;
  batchId?: number | null;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  discount: string;
  lineTotal: string;
}

export type AccountType = 'CASH' | 'BANK';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  openingBalance: string;
  balance?: string;
  isActive: boolean;
}

export interface ExpenseCategory {
  id: number;
  name: string;
}

export interface Expense {
  id: number;
  categoryId: number;
  category?: ExpenseCategory;
  accountId: number;
  account?: Account;
  amount: string;
  expenseDate: string;
  description?: string | null;
  /** Who the money was spent on - the owner, or a particular employee. */
  forUserId?: number | null;
  forUser?: { id: number; name: string; role: 'OWNER' | 'EMPLOYEE' } | null;
  /** Employee personal spending, recovered from their next salary. */
  deductFromSalary?: boolean;
  settledBySalaryPaymentId?: number | null;
}

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Task {
  id: number;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assignedUserId?: number | null;
  completedAt?: string | null;
}

export interface DashboardSnapshot {
  today: { sales: string; collections: string; purchases: string; expenses: string };
  month: { sales: string; expenses: string; revenue: string; cogs: string; grossProfit: string; netProfit: string };
  cashAndBank: string;
  stockValue: string;
  totalFarmerReceivables: string;
  totalSupplierPayables: string;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  lowStockProducts: Product[];
  expiringSoonProducts: Product[];
  overdueSales: Sale[];
  overduePurchases: Purchase[];
  pendingTasks: Task[];
  salesTrend: Array<{ date: string; sales: string; expenses: string }>;
  topProducts: Array<{ name: string; quantity: string; value: string }>;
  finance: FinanceSummary;
  pendingArrivals: PendingArrival[];
  pendingArrivalCount: number;
}

export interface PendingArrival {
  id: number;
  invoiceNumber: string;
  supplier: string;
  total: string;
  balance: string;
  status: DocumentStatus;
  arrivalStatus: ArrivalStatus;
  invoiceDate: string;
  expectedArrivalDate: string | null;
}

export interface PartyBalanceRow {
  id: number;
  name: string;
  amount: string;
}

/**
 * Two different senses of debit and credit, kept apart on purpose:
 * `ledger` is the bookkeeping sense on the farmer/supplier accounts, `money`
 * is cash and bank movement. `receivables`/`payables` are the plain-language
 * answers derived from the first.
 */
export interface FinanceSummary {
  receivables: { total: string; count: number; parties: PartyBalanceRow[]; advances: string };
  payables: { total: string; count: number; parties: PartyBalanceRow[]; advances: string };
  ledger: {
    farmerDebit: string;
    farmerCredit: string;
    supplierDebit: string;
    supplierCredit: string;
    totalDebit: string;
    totalCredit: string;
  };
  accounts: Array<{ id: number; name: string; type: 'CASH' | 'BANK'; moneyIn: string; moneyOut: string; balance: string }>;
  money: { in: string; out: string; net: string };
  netPosition: string;
}
