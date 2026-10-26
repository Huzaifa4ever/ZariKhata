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

/**
 * The debit/credit picture for the dashboard.
 *
 * Two different things get called "debit" and "credit" in a shop, so both are
 * returned separately and the UI labels them:
 *
 *   party ledger - debit raises what a farmer owes us or what we owe a
 *                  supplier; credit settles it. This is the bookkeeping sense.
 *   cash & bank  - credit is money arriving in an account, debit is money
 *                  leaving it.
 *
 * Receivables and payables are the plain-language answers derived from the
 * first: who owes money and to whom. They are summed per party rather than
 * netted across all of them, so one farmer sitting in credit cannot quietly
 * cancel out another farmer's debt and understate what is out on the street.
 */
export async function getDebitCreditSummary(businessId: number) {
  const [farmers, suppliers, accounts, farmerEntries, supplierEntries, accountTxns] = await Promise.all([
    prisma.farmer.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, openingBalance: true } }),
    prisma.supplier.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, openingBalance: true } }),
    prisma.account.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, type: true, openingBalance: true },
      orderBy: { name: 'asc' },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['farmerId', 'direction'],
      where: { businessId, partyType: 'FARMER' },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['supplierId', 'direction'],
      where: { businessId, partyType: 'SUPPLIER' },
      _sum: { amount: true },
    }),
    prisma.accountTransaction.groupBy({ by: ['accountId', 'direction'], where: { businessId }, _sum: { amount: true } }),
  ]);

  type Sides = { debit: Prisma.Decimal; credit: Prisma.Decimal };
  function fold<K extends string>(
    rows: Array<{ direction: string; _sum: { amount: unknown } }>,
    keyOf: (row: never) => number | null,
  ): Map<number, Sides> {
    const map = new Map<number, Sides>();
    for (const row of rows) {
      const key = keyOf(row as never);
      if (key === null) continue;
      const side = map.get(key) ?? { debit: new Decimal(0), credit: new Decimal(0) };
      const amount = new Decimal((row._sum.amount as { toString(): string })?.toString() ?? 0);
      if (row.direction === 'DEBIT') side.debit = side.debit.plus(amount);
      else side.credit = side.credit.plus(amount);
      map.set(key, side);
    }
    return map as Map<number, Sides>;
  }

  const byFarmer = fold(farmerEntries, (r: { farmerId: number | null }) => r.farmerId);
  const bySupplier = fold(supplierEntries, (r: { supplierId: number | null }) => r.supplierId);
  const byAccount = fold(accountTxns, (r: { accountId: number }) => r.accountId);

  const zero = () => ({ debit: new Decimal(0), credit: new Decimal(0) });

  // --- farmers: positive balance is owed to us, negative is credit on account
  let receivables = new Decimal(0);
  let farmerAdvances = new Decimal(0);
  let farmerDebit = new Decimal(0);
  let farmerCredit = new Decimal(0);
  const owing: Array<{ id: number; name: string; amount: string }> = [];
  for (const farmer of farmers) {
    const sides = byFarmer.get(farmer.id) ?? zero();
    farmerDebit = farmerDebit.plus(sides.debit);
    farmerCredit = farmerCredit.plus(sides.credit);
    const balance = new Decimal(farmer.openingBalance.toString()).plus(sides.debit).minus(sides.credit);
    if (balance.gt(0)) {
      receivables = receivables.plus(balance);
      owing.push({ id: farmer.id, name: farmer.name, amount: balance.toFixed(2) });
    } else if (balance.lt(0)) {
      farmerAdvances = farmerAdvances.plus(balance.abs());
    }
  }

  // --- suppliers: positive balance is owed by us, negative is advance paid
  let payables = new Decimal(0);
  let supplierAdvances = new Decimal(0);
  let supplierDebit = new Decimal(0);
  let supplierCredit = new Decimal(0);
  const owed: Array<{ id: number; name: string; amount: string }> = [];
  for (const supplier of suppliers) {
    const sides = bySupplier.get(supplier.id) ?? zero();
    supplierDebit = supplierDebit.plus(sides.debit);
    supplierCredit = supplierCredit.plus(sides.credit);
    const balance = new Decimal(supplier.openingBalance.toString()).plus(sides.debit).minus(sides.credit);
    if (balance.gt(0)) {
      payables = payables.plus(balance);
      owed.push({ id: supplier.id, name: supplier.name, amount: balance.toFixed(2) });
    } else if (balance.lt(0)) {
      supplierAdvances = supplierAdvances.plus(balance.abs());
    }
  }

  // --- cash and bank
  let moneyIn = new Decimal(0);
  let moneyOut = new Decimal(0);
  const accountRows = accounts.map((account) => {
    const sides = byAccount.get(account.id) ?? zero();
    moneyIn = moneyIn.plus(sides.credit);
    moneyOut = moneyOut.plus(sides.debit);
    const balance = new Decimal(account.openingBalance.toString()).plus(sides.credit).minus(sides.debit);
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      moneyIn: sides.credit.toFixed(2),
      moneyOut: sides.debit.toFixed(2),
      balance: balance.toFixed(2),
    };
  });

  const byAmount = (a: { amount: string }, b: { amount: string }) => Number(b.amount) - Number(a.amount);

  return {
    receivables: {
      total: receivables.toFixed(2),
      count: owing.length,
      parties: owing.sort(byAmount).slice(0, 6),
      advances: farmerAdvances.toFixed(2),
    },
    payables: {
      total: payables.toFixed(2),
      count: owed.length,
      parties: owed.sort(byAmount).slice(0, 6),
      advances: supplierAdvances.toFixed(2),
    },
    ledger: {
      farmerDebit: farmerDebit.toFixed(2),
      farmerCredit: farmerCredit.toFixed(2),
      supplierDebit: supplierDebit.toFixed(2),
      supplierCredit: supplierCredit.toFixed(2),
      totalDebit: farmerDebit.plus(supplierDebit).toFixed(2),
      totalCredit: farmerCredit.plus(supplierCredit).toFixed(2),
    },
    accounts: accountRows,
    money: {
      in: moneyIn.toFixed(2),
      out: moneyOut.toFixed(2),
      net: moneyIn.minus(moneyOut).toFixed(2),
    },
    /** Net worth on paper: what we hold, plus what is owed to us, less what we owe. */
    netPosition: accountRows
      .reduce((sum, a) => sum.plus(a.balance), new Decimal(0))
      .plus(receivables)
      .minus(payables)
      .toFixed(2),
  };
}
