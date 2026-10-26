import { Router } from 'express';
import { ArrivalStatus, DocumentStatus, TaskStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import {
  startOfBusinessDay,
  endOfBusinessDay,
  startOfBusinessMonth,
  endOfBusinessMonth,
  formatBusinessDate,
} from '../../lib/dates';
import * as analytics from '../../lib/analytics';
import { parseDateRange } from '../../lib/dateRangeParam';
import { listProducts } from '../products/products.service';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const today = { from: startOfBusinessDay(), to: endOfBusinessDay() };
    // 14 days of history for the trend chart. A shop does tens of rows a day,
    // so pulling the raw records and bucketing them here is cheaper and far
    // simpler than timezone-aware GROUP BY in SQL.
    const TREND_DAYS = 14;
    const trendFrom = startOfBusinessDay(new Date(Date.now() - (TREND_DAYS - 1) * 86_400_000));
    const month = { from: startOfBusinessMonth(), to: endOfBusinessMonth() };
    const now = new Date();

    const [
      todaySales,
      todayCollections,
      todayPurchases,
      todayExpenses,
      monthSales,
      monthExpenses,
      monthProfit,
      stockValue,
      totalReceivables,
      totalPayables,
      totalCashAndBank,
      products,
      overdueSales,
      overduePurchases,
      pendingTasks,
      trendSales,
      trendExpenses,
      monthSaleItems,
      finance,
      pendingArrivals,
    ] = await Promise.all([
      analytics.getSalesTotal(businessId, today),
      analytics.getFarmerCollectionsTotal(businessId, today),
      analytics.getPurchasesTotal(businessId, today),
      analytics.getExpensesTotal(businessId, today),
      analytics.getSalesTotal(businessId, month),
      analytics.getExpensesTotal(businessId, month),
      analytics.getNetProfit(businessId, month),
      analytics.getStockValuation(businessId),
      analytics.getTotalFarmerReceivables(businessId),
      analytics.getTotalSupplierPayables(businessId),
      analytics.getTotalCashAndBank(businessId),
      listProducts(businessId, { activeOnly: true, lowStock: false, outOfStock: false }),
      prisma.sale.findMany({
        where: { businessId, status: { in: [DocumentStatus.UNPAID, DocumentStatus.PARTIALLY_PAID] }, dueDate: { lt: now } },
        include: { farmer: true },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      prisma.purchase.findMany({
        where: { businessId, status: { in: [DocumentStatus.UNPAID, DocumentStatus.PARTIALLY_PAID] }, dueDate: { lt: now } },
        include: { supplier: true },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      prisma.task.findMany({
        where: { businessId, status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      prisma.sale.findMany({
        where: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: trendFrom } },
        select: { invoiceDate: true, total: true },
      }),
      prisma.expense.findMany({
        where: { businessId, expenseDate: { gte: trendFrom } },
        select: { expenseDate: true, amount: true },
      }),
      prisma.saleItem.findMany({
        where: { sale: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: month.from, lte: month.to } } },
        select: { quantity: true, lineTotal: true, product: { select: { name: true } } },
      }),
      analytics.getDebitCreditSummary(businessId),
      // Ordered but not on the shelf yet. These deliberately contribute
      // nothing to stock value or stock counts - they are not here.
      prisma.purchase.findMany({
        where: { businessId, arrivalStatus: { in: [ArrivalStatus.PENDING, ArrivalStatus.PARTIAL] } },
        include: { supplier: { select: { name: true } } },
        orderBy: [{ expectedArrivalDate: 'asc' }, { invoiceDate: 'asc' }],
        take: 20,
      }),
    ]);

    // --- trend series: one bucket per business day, zero-filled so the chart
    // shows quiet days as gaps in the bars rather than skipping them ---
    const buckets = new Map<string, { date: string; sales: number; expenses: number }>();
    for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
      const key = formatBusinessDate(new Date(Date.now() - i * 86_400_000));
      buckets.set(key, { date: key, sales: 0, expenses: 0 });
    }
    for (const s of trendSales) {
      const b = buckets.get(formatBusinessDate(s.invoiceDate));
      if (b) b.sales += Number(s.total);
    }
    for (const e of trendExpenses) {
      const b = buckets.get(formatBusinessDate(e.expenseDate));
      if (b) b.expenses += Number(e.amount);
    }
    const salesTrend = [...buckets.values()].map((b) => ({
      date: b.date,
      sales: b.sales.toFixed(2),
      expenses: b.expenses.toFixed(2),
    }));

    // --- top sellers this month, by value ---
    const byProduct = new Map<string, { name: string; quantity: number; value: number }>();
    for (const item of monthSaleItems) {
      const name = item.product?.name ?? 'Unknown';
      const row = byProduct.get(name) ?? { name, quantity: 0, value: 0 };
      row.quantity += Number(item.quantity);
      row.value += Number(item.lineTotal);
      byProduct.set(name, row);
    }
    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((p) => ({ name: p.name, quantity: p.quantity.toFixed(2), value: p.value.toFixed(2) }));

    const lowStockProducts = products.filter((p) => p.isLowStock);
    const outOfStockProducts = products.filter((p) => p.isOutOfStock);
    const expiringSoonProducts = products.filter((p) => p.hasExpiringSoon);
    const expiredProducts = products.filter((p) => p.hasExpired);

    res.json({
      today: {
        sales: todaySales.toFixed(2),
        collections: todayCollections.toFixed(2),
        purchases: todayPurchases.toFixed(2),
        expenses: todayExpenses.toFixed(2),
      },
      month: {
        sales: monthSales.toFixed(2),
        expenses: monthExpenses.toFixed(2),
        revenue: monthProfit.revenue.toFixed(2),
        cogs: monthProfit.cogs.toFixed(2),
        grossProfit: monthProfit.grossProfit.toFixed(2),
        netProfit: monthProfit.netProfit.toFixed(2),
      },
      cashAndBank: totalCashAndBank.toFixed(2),
      finance,
      pendingArrivals: pendingArrivals.map((p) => ({
        id: p.id,
        invoiceNumber: p.invoiceNumber,
        supplier: p.supplier.name,
        total: p.total.toString(),
        balance: p.balance.toString(),
        status: p.status,
        arrivalStatus: p.arrivalStatus,
        invoiceDate: formatBusinessDate(p.invoiceDate),
        expectedArrivalDate: p.expectedArrivalDate ? formatBusinessDate(p.expectedArrivalDate) : null,
      })),
      pendingArrivalCount: pendingArrivals.length,
      stockValue: stockValue.toFixed(2),
      totalFarmerReceivables: totalReceivables.toFixed(2),
      totalSupplierPayables: totalPayables.toFixed(2),
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      expiringSoonCount: expiringSoonProducts.length,
      expiredCount: expiredProducts.length,
      lowStockProducts: lowStockProducts.slice(0, 20),
      expiringSoonProducts: expiringSoonProducts.slice(0, 20),
      overdueSales,
      overduePurchases,
      pendingTasks,
      salesTrend,
      topProducts,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Sales and expenses over an arbitrary window, for the dashboard chart's own
 * range picker.
 *
 * Buckets by day for short spans and by month once the window is longer than
 * ten weeks - 365 daily bars on a 760px chart is an unreadable comb, and the
 * question people ask of a year is "which months were good", not "which days".
 * Buckets are zero-filled so a quiet day or month shows as a gap rather than
 * being skipped, which would make the x-axis lie about spacing.
 */
dashboardRouter.get('/trend', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const { from, to } = parseDateRange(req.query as Record<string, unknown>);
    const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
    const bucket: 'day' | 'month' = req.query.bucket === 'month' || req.query.bucket === 'day'
      ? (req.query.bucket as 'day' | 'month')
      : spanDays > 70
        ? 'month'
        : 'day';

    const [sales, expenses] = await Promise.all([
      prisma.sale.findMany({
        where: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: from, lte: to } },
        select: { invoiceDate: true, total: true },
      }),
      prisma.expense.findMany({
        where: { businessId, expenseDate: { gte: from, lte: to } },
        select: { expenseDate: true, amount: true },
      }),
    ]);

    const keyOf = (d: Date) => (bucket === 'month' ? formatBusinessDate(d).slice(0, 7) : formatBusinessDate(d));

    const buckets = new Map<string, { date: string; sales: number; expenses: number }>();
    if (bucket === 'day') {
      for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
        const k = formatBusinessDate(new Date(t));
        buckets.set(k, { date: k, sales: 0, expenses: 0 });
      }
    } else {
      const cursor = new Date(from);
      while (cursor <= to) {
        const k = formatBusinessDate(cursor).slice(0, 7);
        if (!buckets.has(k)) buckets.set(k, { date: k, sales: 0, expenses: 0 });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      // The loop above steps by whole months from `from`, so a window that ends
      // mid-month can miss its final bucket.
      const lastKey = formatBusinessDate(to).slice(0, 7);
      if (!buckets.has(lastKey)) buckets.set(lastKey, { date: lastKey, sales: 0, expenses: 0 });
    }

    for (const s of sales) {
      const b = buckets.get(keyOf(s.invoiceDate));
      if (b) b.sales += Number(s.total);
    }
    for (const e of expenses) {
      const b = buckets.get(keyOf(e.expenseDate));
      if (b) b.expenses += Number(e.amount);
    }

    const points = [...buckets.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => ({ date: b.date, sales: b.sales.toFixed(2), expenses: b.expenses.toFixed(2) }));

    res.json({ from, to, bucket, points });
  } catch (err) {
    next(err);
  }
});
