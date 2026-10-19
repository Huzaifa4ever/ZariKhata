import { DocumentStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

const Decimal = Prisma.Decimal;

export interface DateRange {
  from: Date;
  to: Date;
}

async function sumDecimal(promise: Promise<any>, key: string): Promise<Prisma.Decimal> {
  const result = await promise;
  return new Decimal(result._sum?.[key]?.toString() ?? 0);
}

export async function getSalesTotal(businessId: number, range: DateRange) {
  return sumDecimal(
    prisma.sale.aggregate({
      where: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: range.from, lte: range.to } },
      _sum: { total: true },
    }),
    'total',
  );
}

export async function getPurchasesTotal(businessId: number, range: DateRange) {
  return sumDecimal(
    prisma.purchase.aggregate({
      where: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: range.from, lte: range.to } },
      _sum: { total: true },
    }),
    'total',
  );
}

export async function getFarmerCollectionsTotal(businessId: number, range: DateRange) {
  return sumDecimal(
    prisma.farmerPayment.aggregate({
      where: { businessId, paymentDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
    'amount',
  );
}

export async function getSupplierPaymentsTotal(businessId: number, range: DateRange) {
  return sumDecimal(
    prisma.supplierPayment.aggregate({
      where: { businessId, paymentDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
    'amount',
  );
}

export async function getExpensesTotal(businessId: number, range: DateRange) {
  return sumDecimal(
    prisma.expense.aggregate({
      where: { businessId, expenseDate: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    }),
    'amount',
  );
}

/**
 * Gross profit for the period = (sale revenue − returned revenue) − (COGS −
 * returned COGS). A return is counted in the period it happens, not
 * retroactively against the original sale's period — simplest to reason
 * about and matches how a shopkeeper actually experiences "this month's
 * numbers changed because of a return today."
 */
export async function getGrossProfit(businessId: number, range: DateRange) {
  const saleRevenue = await sumDecimal(
    prisma.saleItem.aggregate({
      where: { sale: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: range.from, lte: range.to } } },
      _sum: { lineTotal: true },
    }),
    'lineTotal',
  );
  // Prisma can't express quantity*unitCost in an aggregate, so compute COGS
  // by summing per-row in application code instead.
  const items = await prisma.saleItem.findMany({
    where: { sale: { businessId, status: { not: DocumentStatus.VOID }, invoiceDate: { gte: range.from, lte: range.to } } },
    select: { quantity: true, unitCost: true },
  });
  const actualCogs = items.reduce(
    (sum, i) => sum.plus(new Decimal(i.quantity.toString()).times(i.unitCost.toString())),
    new Decimal(0),
  );

  const returnItems = await prisma.saleReturnItem.findMany({
    where: { saleReturn: { businessId, returnDate: { gte: range.from, lte: range.to } } },
    select: { quantity: true, lineTotal: true, saleItem: { select: { unitCost: true } } },
  });
  const returnedRevenue = returnItems.reduce((sum, i) => sum.plus(i.lineTotal.toString()), new Decimal(0));
  const returnedCogs = returnItems.reduce(
    (sum, i) => sum.plus(new Decimal(i.quantity.toString()).times(i.saleItem.unitCost.toString())),
    new Decimal(0),
  );

  const netRevenue = saleRevenue.minus(returnedRevenue);
  const netCogs = actualCogs.minus(returnedCogs);
  return { revenue: netRevenue, cogs: netCogs, grossProfit: netRevenue.minus(netCogs) };
}

export async function getNetProfit(businessId: number, range: DateRange) {
  const { revenue, cogs, grossProfit } = await getGrossProfit(businessId, range);
  const expenses = await getExpensesTotal(businessId, range);
  return { revenue, cogs, grossProfit, expenses, netProfit: grossProfit.minus(expenses) };
}

/**
 * Stock valuation uses actual per-batch purchase cost (not a simple
 * average): current value = sum over every batch with quantityRemaining > 0
 * of quantityRemaining * purchaseCost. This matches what FIFO sales actually
 * consume, so it reconciles with COGS.
 */
export async function getStockValuation(businessId: number) {
  const batches = await prisma.productBatch.findMany({
    where: { product: { businessId }, quantityRemaining: { gt: 0 } },
    select: { quantityRemaining: true, purchaseCost: true },
  });
  return batches.reduce(
    (sum, b) => sum.plus(new Decimal(b.quantityRemaining.toString()).times(b.purchaseCost.toString())),
    new Decimal(0),
  );
}

export async function getTotalFarmerReceivables(businessId: number) {
  const farmers = await prisma.farmer.findMany({ where: { businessId, isActive: true } });
  const openingSum = farmers.reduce((sum, f) => sum.plus(f.openingBalance.toString()), new Decimal(0));
  const debit = await sumDecimal(
    prisma.ledgerEntry.aggregate({ where: { businessId, partyType: 'FARMER', direction: 'DEBIT' }, _sum: { amount: true } }),
    'amount',
  );
  const credit = await sumDecimal(
    prisma.ledgerEntry.aggregate({ where: { businessId, partyType: 'FARMER', direction: 'CREDIT' }, _sum: { amount: true } }),
    'amount',
  );
  return openingSum.plus(debit).minus(credit);
}

export async function getTotalSupplierPayables(businessId: number) {
  const suppliers = await prisma.supplier.findMany({ where: { businessId, isActive: true } });
  const openingSum = suppliers.reduce((sum, s) => sum.plus(s.openingBalance.toString()), new Decimal(0));
  const debit = await sumDecimal(
    prisma.ledgerEntry.aggregate({ where: { businessId, partyType: 'SUPPLIER', direction: 'DEBIT' }, _sum: { amount: true } }),
    'amount',
  );
  const credit = await sumDecimal(
    prisma.ledgerEntry.aggregate({ where: { businessId, partyType: 'SUPPLIER', direction: 'CREDIT' }, _sum: { amount: true } }),
    'amount',
  );
  return openingSum.plus(debit).minus(credit);
}

export async function getTotalCashAndBank(businessId: number) {
  const accounts = await prisma.account.findMany({ where: { businessId, isActive: true } });
  let total = new Decimal(0);
  const { getAccountBalance } = await import('./accountLedger');
  for (const account of accounts) {
    total = total.plus(await getAccountBalance(prisma, account.id));
  }
  return total;
}
