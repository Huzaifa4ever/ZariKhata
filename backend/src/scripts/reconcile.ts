// Cross-checks every cached/derived balance in the system against an
// independent recomputation from the underlying transaction rows. Run this
// periodically (or after a suspicious bug report) with:
//   npm run reconcile
// It never writes anything — it only reports. A drift here means either a
// bug slipped through, or the database was edited by hand outside the app
// (which should never happen on a production deployment).
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getFarmerBalance, getSupplierBalance } from '../lib/ledger';
import { getAccountBalance } from '../lib/accountLedger';

const Decimal = Prisma.Decimal;
let driftCount = 0;

function report(label: string, expected: Prisma.Decimal, actual: Prisma.Decimal) {
  if (!expected.equals(actual)) {
    driftCount++;
    console.error(`DRIFT: ${label}: expected ${expected.toFixed(2)}, stored/derived ${actual.toFixed(2)}`);
  }
}

async function reconcileBatches() {
  const batches = await prisma.productBatch.findMany();
  for (const batch of batches) {
    const sum = await prisma.stockMovement.aggregate({ where: { batchId: batch.id }, _sum: { quantityChange: true } });
    const expected = new Decimal(sum._sum.quantityChange?.toString() ?? 0);
    report(`ProductBatch #${batch.id} quantityRemaining`, expected, new Decimal(batch.quantityRemaining.toString()));
  }
}

async function reconcileSales() {
  const sales = await prisma.sale.findMany();
  for (const sale of sales) {
    const paid = await prisma.farmerPaymentAllocation.aggregate({ where: { saleId: sale.id }, _sum: { allocatedAmount: true } });
    // A walk-in has no credit account, so its cash never becomes a
    // FarmerPayment - it is posted straight against the sale. Counting only
    // allocations would make every counter sale look unpaid.
    const atCounter = await prisma.accountTransaction.aggregate({
      where: { relatedType: 'Sale', relatedId: sale.id, direction: 'CREDIT' },
      _sum: { amount: true },
    });
    const returned = await prisma.saleReturnItem.aggregate({ where: { saleReturn: { saleId: sale.id } }, _sum: { lineTotal: true } });
    const expectedPaid = new Decimal(paid._sum.allocatedAmount?.toString() ?? 0).plus(
      new Decimal(atCounter._sum.amount?.toString() ?? 0),
    );
    const expectedBalance = new Decimal(sale.total.toString())
      .minus(expectedPaid)
      .minus(new Decimal(returned._sum.lineTotal?.toString() ?? 0));
    report(`Sale #${sale.id} amountPaid`, expectedPaid, new Decimal(sale.amountPaid.toString()));
    report(`Sale #${sale.id} balance`, expectedBalance, new Decimal(sale.balance.toString()));
  }
}

async function reconcilePurchases() {
  const purchases = await prisma.purchase.findMany();
  for (const purchase of purchases) {
    const paid = await prisma.supplierPaymentAllocation.aggregate({ where: { purchaseId: purchase.id }, _sum: { allocatedAmount: true } });
    const returned = await prisma.purchaseReturnItem.aggregate({ where: { purchaseReturn: { purchaseId: purchase.id } }, _sum: { lineTotal: true } });
    const expectedPaid = new Decimal(paid._sum.allocatedAmount?.toString() ?? 0);
    const expectedBalance = new Decimal(purchase.total.toString())
      .minus(expectedPaid)
      .minus(new Decimal(returned._sum.lineTotal?.toString() ?? 0));
    report(`Purchase #${purchase.id} amountPaid`, expectedPaid, new Decimal(purchase.amountPaid.toString()));
    report(`Purchase #${purchase.id} balance`, expectedBalance, new Decimal(purchase.balance.toString()));
  }
}

async function reconcileFarmers() {
  const farmers = await prisma.farmer.findMany();
  for (const farmer of farmers) {
    const sales = await prisma.sale.aggregate({ where: { farmerId: farmer.id, status: { not: 'VOID' } }, _sum: { total: true } });
    const returns = await prisma.saleReturn.aggregate({ where: { saleId: { in: (await prisma.sale.findMany({ where: { farmerId: farmer.id }, select: { id: true } })).map((s) => s.id) } }, _sum: { totalAmount: true } });
    const payments = await prisma.farmerPayment.aggregate({ where: { farmerId: farmer.id }, _sum: { amount: true } });
    const independent = new Decimal(farmer.openingBalance.toString())
      .plus(new Decimal(sales._sum.total?.toString() ?? 0))
      .minus(new Decimal(returns._sum.totalAmount?.toString() ?? 0))
      .minus(new Decimal(payments._sum.amount?.toString() ?? 0));
    const ledgerDerived = await getFarmerBalance(prisma, farmer.id);
    report(`Farmer #${farmer.id} (${farmer.name}) balance`, independent, ledgerDerived);
  }
}

async function reconcileSuppliers() {
  const suppliers = await prisma.supplier.findMany();
  for (const supplier of suppliers) {
    const purchases = await prisma.purchase.aggregate({ where: { supplierId: supplier.id, status: { not: 'VOID' } }, _sum: { total: true } });
    const purchaseIds = (await prisma.purchase.findMany({ where: { supplierId: supplier.id }, select: { id: true } })).map((p) => p.id);
    const returns = await prisma.purchaseReturn.aggregate({ where: { purchaseId: { in: purchaseIds } }, _sum: { totalAmount: true } });
    const payments = await prisma.supplierPayment.aggregate({ where: { supplierId: supplier.id }, _sum: { amount: true } });
    const independent = new Decimal(supplier.openingBalance.toString())
      .plus(new Decimal(purchases._sum.total?.toString() ?? 0))
      .minus(new Decimal(returns._sum.totalAmount?.toString() ?? 0))
      .minus(new Decimal(payments._sum.amount?.toString() ?? 0));
    const ledgerDerived = await getSupplierBalance(prisma, supplier.id);
    report(`Supplier #${supplier.id} (${supplier.name}) balance`, independent, ledgerDerived);
  }
}

async function reconcileAccounts() {
  const accounts = await prisma.account.findMany();
  for (const account of accounts) {
    const received = await prisma.farmerPayment.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
    const paidToSuppliers = await prisma.supplierPayment.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
    const expenses = await prisma.expense.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
    // Two more ways money legitimately moves, neither of which creates a
    // payment or expense row: cash taken over the counter on a walk-in sale,
    // and cash advanced to an employee against their salary.
    const counterSales = await prisma.accountTransaction.aggregate({
      where: { accountId: account.id, relatedType: 'Sale', direction: 'CREDIT' },
      _sum: { amount: true },
    });
    const advances = await prisma.employeeAdvance.aggregate({
      where: { accountId: account.id, settledBySalaryPaymentId: null },
      _sum: { amount: true },
    });
    const independent = new Decimal(account.openingBalance.toString())
      .plus(new Decimal(received._sum.amount?.toString() ?? 0))
      .plus(new Decimal(counterSales._sum.amount?.toString() ?? 0))
      .minus(new Decimal(paidToSuppliers._sum.amount?.toString() ?? 0))
      .minus(new Decimal(expenses._sum.amount?.toString() ?? 0))
      .minus(new Decimal(advances._sum.amount?.toString() ?? 0));
    const ledgerDerived = await getAccountBalance(prisma, account.id);
    report(`Account #${account.id} (${account.name}) balance`, independent, ledgerDerived);
  }
}

async function main() {
  await reconcileBatches();
  await reconcileSales();
  await reconcilePurchases();
  await reconcileFarmers();
  await reconcileSuppliers();
  await reconcileAccounts();

  if (driftCount === 0) {
    console.log('Reconciliation OK: no drift found.');
  } else {
    console.error(`\nReconciliation found ${driftCount} drift(s). See above.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
