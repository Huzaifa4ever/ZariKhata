import { Router } from 'express';
import { DocumentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import { parseDateRange } from '../../lib/dateRangeParam';
import { toCsv } from '../../lib/csv';
import { startOfBusinessMonth, endOfBusinessMonth, startOfBusinessYear, endOfBusinessYear } from '../../lib/dates';
import * as analytics from '../../lib/analytics';
import { getFarmerBalance, getSupplierBalance } from '../../lib/ledger';
import { getAccountBalance } from '../../lib/accountLedger';
import { listProducts } from '../products/products.service';
import { AppError } from '../../lib/errors';

const Decimal = Prisma.Decimal;

export const reportRouter = Router();
reportRouter.use(requireAuth);

// Lists every report this API exposes and where to find it — useful for a
// thin client that wants to build a reports menu without hardcoding paths.
reportRouter.get('/', (_req, res) => {
  res.json({
    reports: [
      { key: 'sales', path: '/api/reports/sales' },
      { key: 'purchases', path: '/api/reports/purchases' },
      { key: 'farmer-receivables', path: '/api/reports/farmer-receivables' },
      { key: 'supplier-payables', path: '/api/reports/supplier-payables' },
      { key: 'farmer-ledger', path: '/api/reports/farmer-ledger/:farmerId' },
      { key: 'supplier-ledger', path: '/api/reports/supplier-ledger/:supplierId' },
      { key: 'account-statement', path: '/api/reports/account-statement/:accountId' },
      { key: 'expenses', path: '/api/reports/expenses' },
      { key: 'stock', path: '/api/reports/stock' },
      { key: 'low-stock', path: '/api/reports/low-stock' },
      { key: 'expiry', path: '/api/reports/expiry' },
      { key: 'stock-valuation', path: '/api/reports/stock-valuation' },
      { key: 'sales-returns', path: '/api/reports/sales-returns' },
      { key: 'purchase-returns', path: '/api/reports/purchase-returns' },
      { key: 'profit-loss', path: '/api/reports/profit-loss' },
      { key: 'monthly-comparison', path: '/api/reports/monthly-comparison' },
      { key: 'yearly-comparison', path: '/api/reports/yearly-comparison' },
      { key: 'outstanding', path: '/api/reports/outstanding' },
    ],
  });
});

/**
 * Every report answers in the same shape: `rows` is the flat, display-ready
 * table and the rest of the body carries totals and context.
 *
 * `rows` used to exist only on the CSV path while JSON clients got raw Prisma
 * records, so the UI rendered nested relations as "[object Object]". Both
 * paths now serve the same flattened rows.
 */
function maybeCsv(req: any, res: any, rows: Array<Record<string, unknown>>, jsonBody: Record<string, unknown>) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.send(toCsv(rows));
  } else {
    res.json({ ...jsonBody, rows });
  }
}

reportRouter.get('/sales', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const farmerId = req.query.farmerId ? Number(req.query.farmerId) : undefined;
    const sales = await prisma.sale.findMany({
      where: {
        businessId: req.businessId!,
        invoiceDate: { gte: from, lte: to },
        ...(farmerId ? { farmerId } : {}),
      },
      include: { farmer: true },
      orderBy: { invoiceDate: 'asc' },
    });
    const rows = sales.map((s) => ({
      invoiceNumber: s.invoiceNumber,
      date: s.invoiceDate.toISOString().slice(0, 10),
      farmer: s.farmer?.name ?? s.customerName ?? 'Walk-in customer',
      // Carried so the report table can open the farmer's record. Null for a
      // walk-in, which has no account to open.
      farmerId: s.farmerId,
      total: s.total.toString(),
      amountPaid: s.amountPaid.toString(),
      balance: s.balance.toString(),
      status: s.status,
    }));
    maybeCsv(req, res, rows, { from, to, count: sales.length, sales });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/purchases', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const purchases = await prisma.purchase.findMany({
      where: { businessId: req.businessId!, invoiceDate: { gte: from, lte: to } },
      include: { supplier: true },
      orderBy: { invoiceDate: 'asc' },
    });
    const rows = purchases.map((p) => ({
      invoiceNumber: p.invoiceNumber,
      date: p.invoiceDate.toISOString().slice(0, 10),
      supplier: p.supplier.name,
      supplierId: p.supplierId,
      total: p.total.toString(),
      amountPaid: p.amountPaid.toString(),
      balance: p.balance.toString(),
      status: p.status,
    }));
    maybeCsv(req, res, rows, { from, to, count: purchases.length, purchases });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/farmer-receivables', async (req, res, next) => {
  try {
    const farmers = await prisma.farmer.findMany({ where: { businessId: req.businessId!, isActive: true } });
    const withBalance = await Promise.all(
      farmers.map(async (f) => ({ id: f.id, name: f.name, phone: f.phone, balance: (await getFarmerBalance(prisma, f.id)).toFixed(2) })),
    );
    const outstanding = withBalance.filter((f) => new Decimal(f.balance).gt(0));
    maybeCsv(req, res, outstanding, { count: outstanding.length, farmers: outstanding });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/supplier-payables', async (req, res, next) => {
  try {
    const suppliers = await prisma.supplier.findMany({ where: { businessId: req.businessId!, isActive: true } });
    const withBalance = await Promise.all(
      suppliers.map(async (s) => ({ id: s.id, name: s.name, phone: s.phone, balance: (await getSupplierBalance(prisma, s.id)).toFixed(2) })),
    );
    const outstanding = withBalance.filter((s) => new Decimal(s.balance).gt(0));
    maybeCsv(req, res, outstanding, { count: outstanding.length, suppliers: outstanding });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/farmer-ledger/:farmerId', async (req, res, next) => {
  try {
    const id = Number(req.params.farmerId);
    const farmer = await prisma.farmer.findFirst({ where: { id, businessId: req.businessId! } });
    if (!farmer) throw AppError.notFound('Farmer not found');
    const entries = await prisma.ledgerEntry.findMany({
      where: { businessId: req.businessId!, partyType: 'FARMER', farmerId: id },
      orderBy: { entryDate: 'asc' },
    });
    res.json({ farmer, openingBalance: farmer.openingBalance, entries });
  } catch (err) {
    next(err);
  }
});

/**
 * Everything about one farmer in a single call: who they are, what they were
 * charged, what they paid, every invoice and receipt, and a running balance.
 * The Reports page prints this as one A4 statement, so it has to be one
 * request — stitching four endpoints together client-side gave inconsistent
 * snapshots when a sale landed mid-render.
 */
reportRouter.get('/farmer-statement/:farmerId', async (req, res, next) => {
  try {
    const id = Number(req.params.farmerId);
    const farmer = await prisma.farmer.findFirst({ where: { id, businessId: req.businessId! } });
    if (!farmer) throw AppError.notFound('Farmer not found');
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);

    const [sales, payments, allEntries] = await Promise.all([
      prisma.sale.findMany({
        where: { businessId: req.businessId!, farmerId: id, invoiceDate: { gte: from, lte: to } },
        include: { items: { include: { product: true } } },
        orderBy: { invoiceDate: 'asc' },
      }),
      prisma.farmerPayment.findMany({
        where: { businessId: req.businessId!, farmerId: id, paymentDate: { gte: from, lte: to } },
        include: { account: true },
        orderBy: { paymentDate: 'asc' },
      }),
      prisma.ledgerEntry.findMany({
        where: { businessId: req.businessId!, partyType: 'FARMER', farmerId: id },
        orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // Opening balance for the window = the farmer's own opening balance plus
    // every movement before `from`. Without this the statement would start at
    // zero and the closing figure would disagree with the Farmers page.
    let running = new Decimal(farmer.openingBalance.toString());
    for (const e of allEntries) {
      if (e.entryDate >= from) break;
      running = e.direction === 'DEBIT' ? running.plus(e.amount.toString()) : running.minus(e.amount.toString());
    }
    const openingBalance = running;

    let charged = new Decimal(0);
    let paid = new Decimal(0);
    const entries = allEntries
      .filter((e) => e.entryDate >= from && e.entryDate <= to)
      .map((e) => {
        if (e.direction === 'DEBIT') {
          running = running.plus(e.amount.toString());
          charged = charged.plus(e.amount.toString());
        } else {
          running = running.minus(e.amount.toString());
          paid = paid.plus(e.amount.toString());
        }
        return {
          date: e.entryDate.toISOString(),
          description: e.description ?? e.relatedType ?? '—',
          debit: e.direction === 'DEBIT' ? e.amount.toString() : '',
          credit: e.direction === 'CREDIT' ? e.amount.toString() : '',
          balance: running.toFixed(2),
        };
      });

    res.json({
      farmer,
      from,
      to,
      summary: {
        openingBalance: openingBalance.toFixed(2),
        charged: charged.toFixed(2),
        paid: paid.toFixed(2),
        closingBalance: running.toFixed(2),
        invoiceCount: sales.length,
        paymentCount: payments.length,
      },
      sales: sales.map((s) => ({
        invoiceNumber: s.invoiceNumber,
        date: s.invoiceDate.toISOString().slice(0, 10),
        items: s.items.length,
        total: s.total.toString(),
        amountPaid: s.amountPaid.toString(),
        balance: s.balance.toString(),
        status: s.status,
      })),
      payments: payments.map((p) => ({
        // id and accountId travel with the row so the party screen can offer
        // admin-mode edit and delete without a second round trip.
        id: p.id,
        accountId: p.accountId,
        date: p.paymentDate.toISOString().slice(0, 10),
        amount: p.amount.toString(),
        method: p.method,
        account: p.account?.name ?? '-',
        notes: p.notes ?? '',
      })),
      entries,
    });
  } catch (err) {
    next(err);
  }
});


/**
 * The supplier mirror of farmer-statement: what they invoiced us, what we paid,
 * and a running payable. Previously only farmers had a statement, so "Supplier
 * Payables" could show a list of balances and nothing else - no dates, no
 * invoice numbers, no line items.
 */
reportRouter.get('/supplier-statement/:supplierId', async (req, res, next) => {
  try {
    const id = Number(req.params.supplierId);
    const supplier = await prisma.supplier.findFirst({ where: { id, businessId: req.businessId! } });
    if (!supplier) throw AppError.notFound('Supplier not found');
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);

    const [purchases, payments, allEntries] = await Promise.all([
      prisma.purchase.findMany({
        where: { businessId: req.businessId!, supplierId: id, invoiceDate: { gte: from, lte: to } },
        include: { items: { include: { product: true } } },
        orderBy: { invoiceDate: 'asc' },
      }),
      prisma.supplierPayment.findMany({
        where: { businessId: req.businessId!, supplierId: id, paymentDate: { gte: from, lte: to } },
        include: { account: true },
        orderBy: { paymentDate: 'asc' },
      }),
      prisma.ledgerEntry.findMany({
        where: { businessId: req.businessId!, partyType: 'SUPPLIER', supplierId: id },
        orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      }),
    ]);

    let running = new Decimal(supplier.openingBalance.toString());
    for (const e of allEntries) {
      if (e.entryDate >= from) break;
      running = e.direction === 'DEBIT' ? running.plus(e.amount.toString()) : running.minus(e.amount.toString());
    }
    const openingBalance = running;

    let billed = new Decimal(0);
    let paid = new Decimal(0);
    const entries = allEntries
      .filter((e) => e.entryDate >= from && e.entryDate <= to)
      .map((e) => {
        if (e.direction === 'DEBIT') {
          running = running.plus(e.amount.toString());
          billed = billed.plus(e.amount.toString());
        } else {
          running = running.minus(e.amount.toString());
          paid = paid.plus(e.amount.toString());
        }
        return {
          date: e.entryDate.toISOString(),
          description: e.description ?? e.relatedType ?? '-',
          debit: e.direction === 'DEBIT' ? e.amount.toString() : '',
          credit: e.direction === 'CREDIT' ? e.amount.toString() : '',
          balance: running.toFixed(2),
        };
      });

    res.json({
      supplier,
      from,
      to,
      summary: {
        openingBalance: openingBalance.toFixed(2),
        billed: billed.toFixed(2),
        paid: paid.toFixed(2),
        closingBalance: running.toFixed(2),
        invoiceCount: purchases.length,
        paymentCount: payments.length,
      },
      purchases: purchases.map((p) => ({
        invoiceNumber: p.invoiceNumber,
        supplierInvoiceNumber: p.supplierInvoiceNumber ?? '',
        date: p.invoiceDate.toISOString().slice(0, 10),
        items: p.items.length,
        total: p.total.toString(),
        amountPaid: p.amountPaid.toString(),
        balance: p.balance.toString(),
        status: p.status,
      })),
      // Line-level detail: which products, how many, at what price.
      lines: purchases.flatMap((p) =>
        p.items.map((i) => ({
          date: p.invoiceDate.toISOString().slice(0, 10),
          invoiceNumber: p.invoiceNumber,
          product: i.product.name,
          sku: i.product.sku,
          quantity: i.quantity.toString(),
          unitCost: i.unitCost.toString(),
          lineTotal: i.lineTotal.toString(),
        })),
      ),
      payments: payments.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        date: p.paymentDate.toISOString().slice(0, 10),
        amount: p.amount.toString(),
        method: p.method,
        account: p.account?.name ?? '-',
        notes: p.notes ?? '',
      })),
      entries,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Look up any invoice by its number, sale or purchase, without the caller
 * needing to know which it is. Returns the party, the lines, what has been
 * paid against it and what is still outstanding.
 */
reportRouter.get('/invoice/:invoiceNumber', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const invoiceNumber = String(req.params.invoiceNumber).trim();

    const sale = await prisma.sale.findFirst({
      where: { businessId, invoiceNumber },
      include: {
        farmer: true,
        items: { include: { product: true } },
        paymentAllocations: { include: { farmerPayment: { include: { account: true } } } },
      },
    });

    if (sale) {
      return res.json({
        kind: 'SALE',
        invoiceNumber: sale.invoiceNumber,
        date: sale.invoiceDate.toISOString().slice(0, 10),
        dueDate: sale.dueDate ? sale.dueDate.toISOString().slice(0, 10) : '',
        party: {
          id: sale.farmerId ?? 0,
          kind: 'FARMER',
          name: sale.farmer?.name ?? sale.customerName ?? 'Walk-in customer',
          phone: sale.farmer?.phone ?? '',
          village: sale.farmer?.village ?? '',
        },
        // Lets the UI tell a credit customer apart from an unregistered buyer.
        isWalkIn: !sale.farmerId,
        lines: sale.items.map((i) => ({
          product: i.product.name,
          sku: i.product.sku,
          quantity: i.quantity.toString(),
          unitPrice: i.unitPrice.toString(),
          discount: i.discount.toString(),
          lineTotal: i.lineTotal.toString(),
        })),
        subtotal: sale.subtotal.toString(),
        discount: sale.discount.toString(),
        total: sale.total.toString(),
        amountPaid: sale.amountPaid.toString(),
        balance: sale.balance.toString(),
        status: sale.status,
        notes: sale.notes ?? '',
        payments: sale.paymentAllocations.map((a) => ({
          date: a.farmerPayment.paymentDate.toISOString().slice(0, 10),
          amount: a.allocatedAmount.toString(),
          method: a.farmerPayment.method,
          account: a.farmerPayment.account?.name ?? '-',
        })),
      });
    }

    const purchase = await prisma.purchase.findFirst({
      where: { businessId, invoiceNumber },
      include: {
        supplier: true,
        items: { include: { product: true } },
        paymentAllocations: { include: { supplierPayment: { include: { account: true } } } },
      },
    });

    if (!purchase) throw AppError.notFound(`No invoice found with number "${invoiceNumber}"`);

    res.json({
      kind: 'PURCHASE',
      invoiceNumber: purchase.invoiceNumber,
      supplierInvoiceNumber: purchase.supplierInvoiceNumber ?? '',
      date: purchase.invoiceDate.toISOString().slice(0, 10),
      dueDate: purchase.dueDate ? purchase.dueDate.toISOString().slice(0, 10) : '',
      party: { id: purchase.supplierId, kind: 'SUPPLIER', name: purchase.supplier.name, phone: purchase.supplier.phone ?? '', village: '' },
      lines: purchase.items.map((i) => ({
        product: i.product.name,
        sku: i.product.sku,
        quantity: i.quantity.toString(),
        unitPrice: i.unitCost.toString(),
        discount: i.discount.toString(),
        lineTotal: i.lineTotal.toString(),
      })),
      subtotal: purchase.subtotal.toString(),
      discount: purchase.discount.toString(),
      total: purchase.total.toString(),
      amountPaid: purchase.amountPaid.toString(),
      balance: purchase.balance.toString(),
      status: purchase.status,
      notes: purchase.notes ?? '',
      payments: purchase.paymentAllocations.map((a) => ({
        date: a.supplierPayment.paymentDate.toISOString().slice(0, 10),
        amount: a.allocatedAmount.toString(),
        method: a.supplierPayment.method,
        account: a.supplierPayment.account?.name ?? '-',
      })),
    });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/supplier-ledger/:supplierId', async (req, res, next) => {
  try {
    const id = Number(req.params.supplierId);
    const supplier = await prisma.supplier.findFirst({ where: { id, businessId: req.businessId! } });
    if (!supplier) throw AppError.notFound('Supplier not found');
    const entries = await prisma.ledgerEntry.findMany({
      where: { businessId: req.businessId!, partyType: 'SUPPLIER', supplierId: id },
      orderBy: { entryDate: 'asc' },
    });
    res.json({ supplier, openingBalance: supplier.openingBalance, entries });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/account-statement/:accountId', async (req, res, next) => {
  try {
    const id = Number(req.params.accountId);
    const account = await prisma.account.findFirst({ where: { id, businessId: req.businessId! } });
    if (!account) throw AppError.notFound('Account not found');
    const transactions = await prisma.accountTransaction.findMany({ where: { accountId: id }, orderBy: { txnDate: 'asc' } });
    let running = new Decimal(account.openingBalance.toString());
    const withRunning = transactions.map((t) => {
      running = t.direction === 'CREDIT' ? running.plus(t.amount.toString()) : running.minus(t.amount.toString());
      return { ...t, runningBalance: running.toFixed(2) };
    });
    res.json({ account: { ...account, balance: (await getAccountBalance(prisma, id)).toFixed(2) }, transactions: withRunning });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/expenses', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const expenses = await prisma.expense.findMany({
      where: { businessId: req.businessId!, expenseDate: { gte: from, lte: to } },
      include: { category: true, account: true },
      orderBy: { expenseDate: 'asc' },
    });
    const byCategory = new Map<string, Prisma.Decimal>();
    for (const e of expenses) {
      const key = e.category.name;
      byCategory.set(key, (byCategory.get(key) ?? new Decimal(0)).plus(e.amount.toString()));
    }
    const rows = expenses.map((e) => ({
      date: e.expenseDate.toISOString().slice(0, 10),
      category: e.category.name,
      account: e.account.name,
      amount: e.amount.toString(),
      description: e.description ?? '',
    }));
    maybeCsv(req, res, rows, {
      from,
      to,
      total: expenses.reduce((s, e) => s.plus(e.amount.toString()), new Decimal(0)).toFixed(2),
      byCategory: Object.fromEntries([...byCategory.entries()].map(([k, v]) => [k, v.toFixed(2)])),
      expenses,
    });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/stock', async (req, res, next) => {
  try {
    const products = await listProducts(req.businessId!, { activeOnly: true });
    const rows = products.map((p) => ({ sku: p.sku, name: p.name, unit: p.unit, currentStock: p.currentStock, sellingPrice: p.sellingPrice.toString() }));
    maybeCsv(req, res, rows, { count: products.length, products });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/low-stock', async (req, res, next) => {
  try {
    const products = await listProducts(req.businessId!, { activeOnly: true, lowStock: true });
    const rows = products.map((p) => ({ sku: p.sku, name: p.name, currentStock: p.currentStock, minStockThreshold: p.minStockThreshold.toString() }));
    maybeCsv(req, res, rows, { count: products.length, products });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/expiry', async (req, res, next) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    const expiring = await listProducts(req.businessId!, { activeOnly: true, expiringSoon: true, expiringSoonDays: days });
    const expired = await listProducts(req.businessId!, { activeOnly: true, expired: true });
    const rows = [
      ...expired.map((p: any) => ({ sku: p.sku, name: p.name, currentStock: p.currentStock, state: 'Expired' })),
      ...expiring.map((p: any) => ({ sku: p.sku, name: p.name, currentStock: p.currentStock, state: `Within ${days} days` })),
    ];
    res.json({ expiringSoonDays: days, expiringSoon: expiring, expired, rows });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/stock-valuation', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const batches = await prisma.productBatch.findMany({
      where: { product: { businessId }, quantityRemaining: { gt: 0 } },
      include: { product: true },
    });
    const byProduct = new Map<number, { name: string; sku: string; quantity: Prisma.Decimal; value: Prisma.Decimal }>();
    for (const b of batches) {
      const entry = byProduct.get(b.productId) ?? { name: b.product.name, sku: b.product.sku, quantity: new Decimal(0), value: new Decimal(0) };
      entry.quantity = entry.quantity.plus(b.quantityRemaining.toString());
      entry.value = entry.value.plus(new Decimal(b.quantityRemaining.toString()).times(b.purchaseCost.toString()));
      byProduct.set(b.productId, entry);
    }
    const rows = [...byProduct.values()].map((v) => ({ sku: v.sku, name: v.name, quantity: v.quantity.toFixed(3), value: v.value.toFixed(2) }));
    const total = await analytics.getStockValuation(businessId);
    res.json({
      method: 'Sum of (quantityRemaining × purchaseCost) per batch, i.e. actual landed cost, not a simple average.',
      total: total.toFixed(2),
      byProduct: rows,
      rows,
    });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/sales-returns', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const returns = await prisma.saleReturn.findMany({
      where: { businessId: req.businessId!, returnDate: { gte: from, lte: to } },
      include: { sale: { include: { farmer: true } }, items: true },
      orderBy: { returnDate: 'asc' },
    });
    res.json({ from, to, count: returns.length, returns });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/purchase-returns', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const returns = await prisma.purchaseReturn.findMany({
      where: { businessId: req.businessId!, returnDate: { gte: from, lte: to } },
      include: { purchase: { include: { supplier: true } }, items: true },
      orderBy: { returnDate: 'asc' },
    });
    res.json({ from, to, count: returns.length, returns });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/profit-loss', async (req, res, next) => {
  try {
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const profit = await analytics.getNetProfit(req.businessId!, { from, to });
    res.json({
      from,
      to,
      revenue: profit.revenue.toFixed(2),
      cogs: profit.cogs.toFixed(2),
      grossProfit: profit.grossProfit.toFixed(2),
      expenses: profit.expenses.toFixed(2),
      netProfit: profit.netProfit.toFixed(2),
    });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/monthly-comparison', async (req, res, next) => {
  try {
    const months = req.query.months ? Number(req.query.months) : 6;
    const businessId = req.businessId!;
    const results = [];
    let cursor = new Date();
    for (let i = 0; i < months; i++) {
      const from = startOfBusinessMonth(cursor);
      const to = endOfBusinessMonth(cursor);
      const [sales, expenses, profit] = await Promise.all([
        analytics.getSalesTotal(businessId, { from, to }),
        analytics.getExpensesTotal(businessId, { from, to }),
        analytics.getNetProfit(businessId, { from, to }),
      ]);
      results.unshift({
        month: from.toISOString().slice(0, 7),
        sales: sales.toFixed(2),
        expenses: expenses.toFixed(2),
        grossProfit: profit.grossProfit.toFixed(2),
        netProfit: profit.netProfit.toFixed(2),
      });
      const prevMonth = new Date(cursor);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      cursor = prevMonth;
    }
    res.json({ months: results });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/yearly-comparison', async (req, res, next) => {
  try {
    const years = req.query.years ? Number(req.query.years) : 3;
    const businessId = req.businessId!;
    const results = [];
    let cursor = new Date();
    for (let i = 0; i < years; i++) {
      const from = startOfBusinessYear(cursor);
      const to = endOfBusinessYear(cursor);
      const [sales, expenses, profit] = await Promise.all([
        analytics.getSalesTotal(businessId, { from, to }),
        analytics.getExpensesTotal(businessId, { from, to }),
        analytics.getNetProfit(businessId, { from, to }),
      ]);
      results.unshift({
        year: from.getUTCFullYear(),
        sales: sales.toFixed(2),
        expenses: expenses.toFixed(2),
        grossProfit: profit.grossProfit.toFixed(2),
        netProfit: profit.netProfit.toFixed(2),
      });
      cursor.setFullYear(cursor.getFullYear() - 1);
    }
    res.json({ years: results });
  } catch (err) {
    next(err);
  }
});

reportRouter.get('/outstanding', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const now = new Date();
    const sales = await prisma.sale.findMany({
      where: { businessId, status: { in: [DocumentStatus.UNPAID, DocumentStatus.PARTIALLY_PAID] } },
      include: { farmer: true },
      orderBy: { dueDate: 'asc' },
    });
    const purchases = await prisma.purchase.findMany({
      where: { businessId, status: { in: [DocumentStatus.UNPAID, DocumentStatus.PARTIALLY_PAID] } },
      include: { supplier: true },
      orderBy: { dueDate: 'asc' },
    });
    res.json({
      sales: sales.map((s) => ({ ...s, isOverdue: !!s.dueDate && s.dueDate < now })),
      purchases: purchases.map((p) => ({ ...p, isOverdue: !!p.dueDate && p.dueDate < now })),
    });
  } catch (err) {
    next(err);
  }
});
