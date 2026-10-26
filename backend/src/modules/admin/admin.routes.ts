/**
 * Owner-only destructive operations ("Admin mode").
 *
 * The whole accounting model is append-only: balances are derived by summing
 * ledger entries, stock movements and account transactions, never by editing a
 * stored total. So a delete here is not a row drop — it removes the record
 * *and every artifact it created*, inside one transaction, so the derived
 * balances stay correct afterwards. Deleting a sale, for example, must also
 * remove its ledger entry, its stock movements and any payment allocations
 * pointing at it.
 *
 * Everything is written to the audit log before it goes, so there is still a
 * trail of what was removed and by whom.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runInTransaction } from '../../lib/db';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { parseBusinessDate } from '../../lib/dates';
import { recordAccountTransaction } from '../../lib/accountLedger';
import { recordStockMovement, reverseStockMovements, lockProductRow } from '../../lib/stock';
import { consumeBatchesFifo } from '../../lib/fifoBatches';
import { recordLedgerEntry } from '../../lib/ledger';
import { allocateOldestFirst } from '../../lib/paymentAllocation';
import { deriveStatus } from '../../lib/invoiceStatus';
import { Prisma, StockMovementReason, PartyType, LedgerDirection, PaymentMethod } from '@prisma/client';
import type { Tx } from '../../db/prisma';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('OWNER'));

async function audit(tx: Tx, req: any, entityType: string, entityId: number, beforeData: unknown) {
  await writeAuditLog(tx, {
    businessId: req.businessId!,
    userId: req.user!.id,
    action: 'DELETE',
    entityType,
    entityId,
    beforeData: beforeData as any,
    ipAddress: req.ip,
  });
}

/** Drop every ledger/account/stock artifact that points at one document. */
async function clearArtifacts(tx: Tx, businessId: number, relatedType: string, relatedId: number) {
  await tx.ledgerEntry.deleteMany({ where: { businessId, relatedType, relatedId } });
  await tx.accountTransaction.deleteMany({ where: { businessId, relatedType, relatedId } });
  // Not a plain deleteMany: batch counters have to be wound back first.
  await reverseStockMovements(tx, businessId, relatedType, relatedId);
}

/* ───────────────────────────── expense ───────────────────────────── */

adminRouter.delete('/expenses/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, businessId } });
      if (!expense) throw AppError.notFound('Expense not found');
      // Once a salary has recovered it, deleting it would silently change what
      // that employee was already paid. Undo the salary payment first.
      if (expense.settledBySalaryPaymentId) {
        throw AppError.badRequest(
          'This expense was already deducted from a paid salary. Undo that salary payment first.',
        );
      }
      await audit(tx, req, 'Expense', id, expense);
      await clearArtifacts(tx, businessId, 'Expense', id);
      await tx.expense.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

const expenseUpdateSchema = z.object({
  categoryId: z.number().int().optional(),
  accountId: z.number().int().optional(),
  amount: z.number().positive().optional(),
  expenseDate: z.string().optional(),
  description: z.string().optional(),
  forUserId: z.number().int().optional(),
  deductFromSalary: z.boolean().optional(),
});

/**
 * Correcting an expense after the fact. The amount and the account both move
 * money, so the old account transaction is removed and a fresh one posted
 * rather than patched in place — that keeps the derived account balance
 * correct whether the amount changed, the account changed, or both.
 */
adminRouter.patch('/expenses/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const data = expenseUpdateSchema.parse(req.body);

    const updated = await runInTransaction(async (tx) => {
      const before = await tx.expense.findFirst({ where: { id, businessId } });
      if (!before) throw AppError.notFound('Expense not found');
      if (before.settledBySalaryPaymentId) {
        throw AppError.badRequest(
          'This expense was already deducted from a paid salary. Undo that salary payment first.',
        );
      }

      if (data.deductFromSalary) {
        const target = await tx.user.findFirst({
          where: { id: data.forUserId ?? before.forUserId ?? 0, businessId },
        });
        if (target?.role !== 'EMPLOYEE') {
          throw AppError.badRequest("Only an employee's expense can be deducted from a salary.");
        }
      }

      const after = await tx.expense.update({
        where: { id },
        data: {
          categoryId: data.categoryId,
          accountId: data.accountId,
          amount: data.amount,
          description: data.description,
          forUserId: data.forUserId,
          deductFromSalary: data.deductFromSalary,
          expenseDate: data.expenseDate ? parseBusinessDate(data.expenseDate) : undefined,
        },
        include: { category: true, account: true },
      });

      await tx.accountTransaction.deleteMany({ where: { businessId, relatedType: 'Expense', relatedId: id } });
      await recordAccountTransaction(tx, {
        businessId,
        accountId: after.accountId,
        direction: 'DEBIT',
        amount: after.amount.toString(),
        relatedType: 'Expense',
        relatedId: id,
        description: after.description ?? after.category.name,
        txnDate: after.expenseDate,
      });

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'UPDATE',
        entityType: 'Expense',
        entityId: id,
        beforeData: before as any,
        afterData: after as any,
        ipAddress: req.ip,
      });
      return after;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ───────────────────────────── sale ───────────────────────────── */

adminRouter.delete('/sales/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id, businessId }, include: { items: true } });
      if (!sale) throw AppError.notFound('Sale not found');

      const returns = await tx.saleReturn.count({ where: { saleId: id } });
      if (returns > 0) throw AppError.badRequest("Delete this sale's returns first, then delete the sale.");

      await audit(tx, req, 'Sale', id, sale);

      // Payments allocated to this invoice become unallocated rather than
      // vanishing — the farmer really did hand over that money.
      await tx.farmerPaymentAllocation.deleteMany({ where: { saleId: id } });
      await clearArtifacts(tx, businessId, 'Sale', id);
      await tx.saleItem.deleteMany({ where: { saleId: id } });
      await tx.sale.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/* ───────────────────────────── purchase ───────────────────────────── */

adminRouter.delete('/purchases/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, businessId }, include: { items: true } });
      if (!purchase) throw AppError.notFound('Purchase not found');

      const returns = await tx.purchaseReturn.count({ where: { purchaseId: id } });
      if (returns > 0) throw AppError.badRequest("Delete this purchase's returns first, then delete the purchase.");

      // Goods from this purchase may already have been sold out of their
      // batch. Removing the purchase would leave those sales costed against
      // stock that never arrived, so refuse instead of corrupting the books.
      const batchIds = purchase.items.map((i) => i.batchId).filter((b): b is number => b !== null);
      if (batchIds.length > 0) {
        const sold = await tx.saleItem.count({ where: { batchId: { in: batchIds } } });
        if (sold > 0) {
          throw AppError.badRequest('Some of this stock has already been sold. Record a purchase return instead.');
        }
      }

      await audit(tx, req, 'Purchase', id, purchase);
      await tx.supplierPaymentAllocation.deleteMany({ where: { purchaseId: id } });
      await clearArtifacts(tx, businessId, 'Purchase', id);

      // Delivery records hang off the purchase items, and a short or damaged
      // delivery posted its own credit note against the supplier. Both have to
      // go with the purchase or the supplier balance keeps a credit for an
      // invoice that no longer exists.
      const receipts = await tx.purchaseReceipt.findMany({ where: { businessId, purchaseId: id }, select: { id: true } });
      for (const receipt of receipts) {
        await clearArtifacts(tx, businessId, 'PurchaseReceipt', receipt.id);
      }
      await tx.purchaseReceiptItem.deleteMany({ where: { receiptId: { in: receipts.map((r) => r.id) } } });
      await tx.purchaseReceipt.deleteMany({ where: { businessId, purchaseId: id } });

      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      if (batchIds.length > 0) await tx.productBatch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.purchase.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});


const Decimal = Prisma.Decimal;

const saleItemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discount: z.number().min(0).optional(),
});

const saleUpdateSchema = z.object({
  farmerId: z.number().int().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().nullish(),
  discount: z.number().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(saleItemSchema).min(1),
});

/**
 * Edit a sale invoice.
 *
 * Implemented as reverse-then-reapply inside one transaction rather than a
 * field patch: the invoice's stock movements, FIFO batch consumption and
 * ledger entry all have to be unwound before the new lines can be costed, or
 * the second set of movements would stack on top of the first. The invoice
 * keeps its id and its number — it is the same document, corrected — and any
 * payments already allocated to it survive untouched.
 */
adminRouter.patch('/sales/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const data = saleUpdateSchema.parse(req.body);

    const result = await runInTransaction(async (tx) => {
      const before = await tx.sale.findFirst({
        where: { id, businessId },
        include: { items: true, paymentAllocations: true },
      });
      if (!before) throw AppError.notFound('Sale not found');

      const returns = await tx.saleReturn.count({ where: { saleId: id } });
      if (returns > 0) {
        throw AppError.badRequest('This invoice has returns against it. Delete those first, then edit it.');
      }

      // May stay null: editing a walk-in sale must not force a farmer onto it.
      const farmerId = data.farmerId ?? before.farmerId;
      const farmer = farmerId
        ? await tx.farmer.findFirst({ where: { id: farmerId, businessId } })
        : null;
      if (farmerId && !farmer) throw AppError.notFound('Farmer not found');

      const lines = data.items.map((item) => ({
        ...item,
        lineTotal: new Decimal(item.quantity).times(item.unitPrice).minus(item.discount ?? 0),
      }));
      const subtotal = lines.reduce((sum, i) => sum.plus(i.lineTotal), new Decimal(0));
      const invoiceDiscount = new Decimal(data.discount ?? before.discount.toString());
      const total = subtotal.minus(invoiceDiscount);
      if (total.lt(0)) throw AppError.badRequest('Total cannot be negative');

      // Money already taken for this invoice is a fact; the edited total has
      // to be able to hold it. Refusing is safer than silently creating a
      // credit the farmer never agreed to.
      const alreadyPaid = before.paymentAllocations.reduce(
        (sum, a) => sum.plus(a.allocatedAmount.toString()),
        new Decimal(0),
      );
      if (alreadyPaid.gt(total)) {
        throw AppError.badRequest(
          `This invoice already has ${alreadyPaid.toFixed(2)} paid against it, which is more than the new total of ${total.toFixed(2)}. Reduce or remove the payment first.`,
        );
      }

      // --- unwind ---
      await reverseStockMovements(tx, businessId, 'Sale', id);
      await tx.ledgerEntry.deleteMany({ where: { businessId, relatedType: 'Sale', relatedId: id } });
      await tx.saleItem.deleteMany({ where: { saleId: id } });

      // --- re-apply ---
      for (const item of lines) {
        await lockProductRow(tx, item.productId);
        const { consumed, weightedUnitCost } = await consumeBatchesFifo(tx, {
          businessId,
          productId: item.productId,
          quantity: item.quantity,
          relatedType: 'Sale',
          relatedId: id,
          createdByUserId: req.user!.id,
        });
        await tx.saleItem.create({
          data: {
            saleId: id,
            productId: item.productId,
            batchId: consumed[0]?.batchId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: weightedUnitCost.toString(),
            discount: item.discount ?? 0,
            lineTotal: item.lineTotal.toString(),
          },
        });
      }

      const invoiceDate = data.invoiceDate ? parseBusinessDate(data.invoiceDate) : before.invoiceDate;
      const after = await tx.sale.update({
        where: { id },
        data: {
          farmerId,
          invoiceDate,
          dueDate: data.dueDate === undefined ? undefined : data.dueDate ? parseBusinessDate(data.dueDate) : null,
          subtotal: subtotal.toString(),
          discount: invoiceDiscount.toString(),
          total: total.toString(),
          amountPaid: alreadyPaid.toString(),
          balance: total.minus(alreadyPaid).toString(),
          status: deriveStatus(total, alreadyPaid),
          notes: data.notes,
        },
      });

      if (farmer) {
        await recordLedgerEntry(tx, {
          businessId,
          partyType: PartyType.FARMER,
          farmerId: farmer.id,
          direction: LedgerDirection.DEBIT,
          amount: total,
          relatedType: 'Sale',
          relatedId: id,
          description: `Sale ${after.invoiceNumber}`,
          entryDate: invoiceDate,
        });
      }

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'UPDATE',
        entityType: 'Sale',
        entityId: id,
        beforeData: { total: before.total.toString(), items: before.items.length, farmerId: before.farmerId },
        afterData: { total: total.toString(), items: lines.length, farmerId },
        ipAddress: req.ip,
      });

      return after;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

const purchaseItemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitCost: z.number().min(0),
  discount: z.number().min(0).optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
});

const purchaseUpdateSchema = z.object({
  supplierId: z.number().int().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().nullish(),
  supplierInvoiceNumber: z.string().optional(),
  discount: z.number().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(purchaseItemSchema).min(1),
});

/**
 * Edit a purchase invoice. Same reverse-then-reapply shape as a sale, with one
 * extra guard: a purchase creates the batches that stock is later sold out of,
 * so if anything has already been sold from them the old batches cannot be
 * replaced without stranding those sales' cost basis.
 */
adminRouter.patch('/purchases/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const data = purchaseUpdateSchema.parse(req.body);

    const result = await runInTransaction(async (tx) => {
      const before = await tx.purchase.findFirst({
        where: { id, businessId },
        include: { items: true, paymentAllocations: true },
      });
      if (!before) throw AppError.notFound('Purchase not found');
      // An edit rebuilds the lines from scratch. On an order that is still
      // arriving that would throw away the delivery record and the stock it
      // already produced, so finish receiving it first.
      if (before.arrivalStatus !== 'RECEIVED') {
        throw AppError.badRequest(
          'This order has not fully arrived yet. Confirm or close the arrival first, then edit it.',
        );
      }

      const returns = await tx.purchaseReturn.count({ where: { purchaseId: id } });
      if (returns > 0) {
        throw AppError.badRequest('This purchase has returns against it. Delete those first, then edit it.');
      }

      const oldBatchIds = before.items.map((i) => i.batchId).filter((b): b is number => b !== null);
      if (oldBatchIds.length > 0) {
        const sold = await tx.saleItem.count({ where: { batchId: { in: oldBatchIds } } });
        if (sold > 0) {
          throw AppError.badRequest('Stock from this purchase has already been sold, so it can no longer be edited. Record a purchase return instead.');
        }
      }

      const supplierId = data.supplierId ?? before.supplierId;
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, businessId } });
      if (!supplier) throw AppError.notFound('Supplier not found');

      const lines = data.items.map((item) => ({
        ...item,
        lineTotal: new Decimal(item.quantity).times(item.unitCost).minus(item.discount ?? 0),
      }));
      const subtotal = lines.reduce((sum, i) => sum.plus(i.lineTotal), new Decimal(0));
      const invoiceDiscount = new Decimal(data.discount ?? before.discount.toString());
      const total = subtotal.minus(invoiceDiscount);
      if (total.lt(0)) throw AppError.badRequest('Total cannot be negative');

      const alreadyPaid = before.paymentAllocations.reduce(
        (sum, a) => sum.plus(a.allocatedAmount.toString()),
        new Decimal(0),
      );
      if (alreadyPaid.gt(total)) {
        throw AppError.badRequest(
          `You have already paid ${alreadyPaid.toFixed(2)} against this purchase, which is more than the new total of ${total.toFixed(2)}. Reduce or remove the payment first.`,
        );
      }

      // --- unwind ---
      await reverseStockMovements(tx, businessId, 'Purchase', id);
      await tx.ledgerEntry.deleteMany({ where: { businessId, relatedType: 'Purchase', relatedId: id } });
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      if (oldBatchIds.length > 0) await tx.productBatch.deleteMany({ where: { id: { in: oldBatchIds } } });

      // --- re-apply ---
      for (const item of lines) {
        const batch = await tx.productBatch.create({
          data: {
            productId: item.productId,
            batchNumber: item.batchNumber || null,
            supplierId,
            expiryDate: item.expiryDate ? parseBusinessDate(item.expiryDate) : null,
            purchaseCost: item.unitCost,
            quantityReceived: item.quantity,
            quantityRemaining: 0, // recordStockMovement is the sole writer
          },
        });
        await tx.purchaseItem.create({
          data: {
            purchaseId: id,
            productId: item.productId,
            batchId: batch.id,
            quantity: item.quantity,
            unitCost: item.unitCost,
            discount: item.discount ?? 0,
            lineTotal: item.lineTotal.toString(),
          },
        });
        await recordStockMovement(tx, {
          businessId,
          productId: item.productId,
          batchId: batch.id,
          reason: StockMovementReason.PURCHASE,
          quantityChange: item.quantity,
          relatedType: 'Purchase',
          relatedId: id,
          createdByUserId: req.user!.id,
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { lastPurchaseCost: item.unitCost },
        });
      }

      const invoiceDate = data.invoiceDate ? parseBusinessDate(data.invoiceDate) : before.invoiceDate;
      const after = await tx.purchase.update({
        where: { id },
        data: {
          supplierId,
          invoiceDate,
          dueDate: data.dueDate === undefined ? undefined : data.dueDate ? parseBusinessDate(data.dueDate) : null,
          supplierInvoiceNumber: data.supplierInvoiceNumber,
          subtotal: subtotal.toString(),
          discount: invoiceDiscount.toString(),
          total: total.toString(),
          amountPaid: alreadyPaid.toString(),
          balance: total.minus(alreadyPaid).toString(),
          status: deriveStatus(total, alreadyPaid),
          notes: data.notes,
        },
      });

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.SUPPLIER,
        supplierId,
        // DEBIT, matching createPurchase: it increases what the shop owes.
        direction: LedgerDirection.DEBIT,
        amount: total,
        relatedType: 'Purchase',
        relatedId: id,
        description: `Purchase ${after.invoiceNumber}`,
        entryDate: invoiceDate,
      });

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'UPDATE',
        entityType: 'Purchase',
        entityId: id,
        beforeData: { total: before.total.toString(), items: before.items.length, supplierId: before.supplierId },
        afterData: { total: total.toString(), items: lines.length, supplierId },
        ipAddress: req.ip,
      });

      return after;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ───────────────────────── payments ───────────────────────── */

/**
 * Put the invoices a payment was applied to back the way they were.
 *
 * Deleting the allocation rows is not enough: `amountPaid`, `balance` and
 * `status` are stored on the invoice, so without this an invoice keeps
 * crediting money that no longer exists anywhere. That is exactly how a sale
 * ends up reading "Paid" with no payment behind it.
 */
async function unapplyFarmerPayment(tx: Tx, paymentId: number) {
  const allocations = await tx.farmerPaymentAllocation.findMany({ where: { farmerPaymentId: paymentId } });
  for (const allocation of allocations) {
    const sale = await tx.sale.findUnique({ where: { id: allocation.saleId } });
    if (!sale) continue;
    const amountPaid = Decimal.max(
      new Decimal(0),
      new Decimal(sale.amountPaid.toString()).minus(allocation.allocatedAmount.toString()),
    );
    const balance = new Decimal(sale.total.toString()).minus(amountPaid);
    await tx.sale.update({
      where: { id: sale.id },
      data: { amountPaid: amountPaid.toString(), balance: balance.toString(), status: deriveStatus(sale.total, amountPaid) },
    });
  }
  await tx.farmerPaymentAllocation.deleteMany({ where: { farmerPaymentId: paymentId } });
}

async function unapplySupplierPayment(tx: Tx, paymentId: number) {
  const allocations = await tx.supplierPaymentAllocation.findMany({ where: { supplierPaymentId: paymentId } });
  for (const allocation of allocations) {
    const purchase = await tx.purchase.findUnique({ where: { id: allocation.purchaseId } });
    if (!purchase) continue;
    const amountPaid = Decimal.max(
      new Decimal(0),
      new Decimal(purchase.amountPaid.toString()).minus(allocation.allocatedAmount.toString()),
    );
    const balance = new Decimal(purchase.total.toString()).minus(amountPaid);
    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        amountPaid: amountPaid.toString(),
        balance: balance.toString(),
        status: deriveStatus(purchase.total, amountPaid),
      },
    });
  }
  await tx.supplierPaymentAllocation.deleteMany({ where: { supplierPaymentId: paymentId } });
}

/** Spread an amount over that party's open invoices, oldest first. */
async function applyFarmerPayment(tx: Tx, paymentId: number, farmerId: number, amount: Prisma.Decimal) {
  const open = await tx.sale.findMany({
    where: { farmerId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    orderBy: { invoiceDate: 'asc' },
  });
  const { allocations } = allocateOldestFirst(open.map((s) => ({ id: s.id, balance: s.balance })), amount);
  for (const allocation of allocations) {
    await tx.farmerPaymentAllocation.create({
      data: { farmerPaymentId: paymentId, saleId: allocation.invoiceId, allocatedAmount: allocation.amount.toString() },
    });
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
    const amountPaid = new Decimal(sale.amountPaid.toString()).plus(allocation.amount);
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        amountPaid: amountPaid.toString(),
        balance: new Decimal(sale.total.toString()).minus(amountPaid).toString(),
        status: deriveStatus(sale.total, amountPaid),
      },
    });
  }
}

async function applySupplierPayment(tx: Tx, paymentId: number, supplierId: number, amount: Prisma.Decimal) {
  const open = await tx.purchase.findMany({
    where: { supplierId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
    orderBy: { invoiceDate: 'asc' },
  });
  const { allocations } = allocateOldestFirst(open.map((p) => ({ id: p.id, balance: p.balance })), amount);
  for (const allocation of allocations) {
    await tx.supplierPaymentAllocation.create({
      data: {
        supplierPaymentId: paymentId,
        purchaseId: allocation.invoiceId,
        allocatedAmount: allocation.amount.toString(),
      },
    });
    const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
    const amountPaid = new Decimal(purchase.amountPaid.toString()).plus(allocation.amount);
    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        amountPaid: amountPaid.toString(),
        balance: new Decimal(purchase.total.toString()).minus(amountPaid).toString(),
        status: deriveStatus(purchase.total, amountPaid),
      },
    });
  }
}

adminRouter.delete('/farmer-payments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const payment = await tx.farmerPayment.findFirst({ where: { id, businessId } });
      if (!payment) throw AppError.notFound('Payment not found');
      await audit(tx, req, 'FarmerPayment', id, payment);
      await unapplyFarmerPayment(tx, id);
      await clearArtifacts(tx, businessId, 'FarmerPayment', id);
      await tx.farmerPayment.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/supplier-payments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const payment = await tx.supplierPayment.findFirst({ where: { id, businessId } });
      if (!payment) throw AppError.notFound('Payment not found');
      await audit(tx, req, 'SupplierPayment', id, payment);
      await unapplySupplierPayment(tx, id);
      await clearArtifacts(tx, businessId, 'SupplierPayment', id);
      await tx.supplierPayment.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

const paymentUpdateSchema = z.object({
  amount: z.number().positive().optional(),
  accountId: z.number().int().optional(),
  paymentDate: z.string().optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().optional(),
});

/**
 * Correcting a payment after the fact.
 *
 * A payment touches three places - the party ledger, the cash/bank account and
 * whichever invoices it settled - so it is unwound completely and re-applied,
 * rather than patched in place. Re-applying uses the same oldest-invoice-first
 * rule as recording a fresh payment, so a corrected amount lands exactly where
 * the original would have.
 */
adminRouter.patch('/farmer-payments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const data = paymentUpdateSchema.parse(req.body);

    const updated = await runInTransaction(async (tx) => {
      const before = await tx.farmerPayment.findFirst({ where: { id, businessId }, include: { farmer: true } });
      if (!before) throw AppError.notFound('Payment not found');

      await unapplyFarmerPayment(tx, id);
      await clearArtifacts(tx, businessId, 'FarmerPayment', id);

      const amount = new Decimal(data.amount ?? before.amount.toString());
      const accountId = data.accountId ?? before.accountId;
      const account = await tx.account.findFirst({ where: { id: accountId, businessId } });
      if (!account) throw AppError.notFound('Account not found');

      const after = await tx.farmerPayment.update({
        where: { id },
        data: {
          amount: amount.toString(),
          accountId,
          method: data.method ?? before.method,
          notes: data.notes ?? before.notes,
          paymentDate: data.paymentDate ? parseBusinessDate(data.paymentDate) : before.paymentDate,
        },
      });

      await applyFarmerPayment(tx, id, before.farmerId, amount);

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.FARMER,
        farmerId: before.farmerId,
        direction: LedgerDirection.CREDIT,
        amount,
        relatedType: 'FarmerPayment',
        relatedId: id,
        description: after.notes ?? 'Payment received from farmer',
        entryDate: after.paymentDate,
      });
      await recordAccountTransaction(tx, {
        businessId,
        accountId,
        direction: LedgerDirection.CREDIT,
        amount,
        relatedType: 'FarmerPayment',
        relatedId: id,
        description: `Payment from ${before.farmer.name}`,
        txnDate: after.paymentDate,
      });

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'UPDATE',
        entityType: 'FarmerPayment',
        entityId: id,
        beforeData: before as any,
        afterData: after as any,
        ipAddress: req.ip,
      });
      return after;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/supplier-payments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const data = paymentUpdateSchema.parse(req.body);

    const updated = await runInTransaction(async (tx) => {
      const before = await tx.supplierPayment.findFirst({ where: { id, businessId }, include: { supplier: true } });
      if (!before) throw AppError.notFound('Payment not found');

      await unapplySupplierPayment(tx, id);
      await clearArtifacts(tx, businessId, 'SupplierPayment', id);

      const amount = new Decimal(data.amount ?? before.amount.toString());
      const accountId = data.accountId ?? before.accountId;
      const account = await tx.account.findFirst({ where: { id: accountId, businessId } });
      if (!account) throw AppError.notFound('Account not found');

      const after = await tx.supplierPayment.update({
        where: { id },
        data: {
          amount: amount.toString(),
          accountId,
          method: data.method ?? before.method,
          notes: data.notes ?? before.notes,
          paymentDate: data.paymentDate ? parseBusinessDate(data.paymentDate) : before.paymentDate,
        },
      });

      await applySupplierPayment(tx, id, before.supplierId, amount);

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.SUPPLIER,
        supplierId: before.supplierId,
        direction: LedgerDirection.CREDIT,
        amount,
        relatedType: 'SupplierPayment',
        relatedId: id,
        description: after.notes ?? 'Payment made to supplier',
        entryDate: after.paymentDate,
      });
      await recordAccountTransaction(tx, {
        businessId,
        accountId,
        direction: LedgerDirection.DEBIT,
        amount,
        relatedType: 'SupplierPayment',
        relatedId: id,
        description: `Payment to ${before.supplier.name}`,
        txnDate: after.paymentDate,
      });

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'UPDATE',
        entityType: 'SupplierPayment',
        entityId: id,
        beforeData: before as any,
        afterData: after as any,
        ipAddress: req.ip,
      });
      return after;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/* ───────────────────── order arrivals ───────────────────── */

/**
 * Undo a delivery that was confirmed by mistake.
 *
 * Takes the stock back off the shelf, reverses any credit note the delivery
 * raised for damaged or written-off goods, re-prices the invoice lines, and
 * puts the order back to pending or partly-arrived. Refused once the stock has
 * been sold on, because there would be nothing to take back.
 */
adminRouter.delete('/purchase-receipts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;

    await runInTransaction(async (tx) => {
      const receipt = await tx.purchaseReceipt.findFirst({
        where: { id, businessId },
        include: { items: { include: { purchaseItem: true } }, purchase: { include: { items: true } } },
      });
      if (!receipt) throw AppError.notFound('Delivery not found');

      for (const line of receipt.items) {
        const accepted = new Decimal(line.quantityAccepted.toString());
        if (accepted.gt(0) && line.purchaseItem.batchId) {
          const batch = await tx.productBatch.findUniqueOrThrow({ where: { id: line.purchaseItem.batchId } });
          if (new Decimal(batch.quantityRemaining.toString()).lt(accepted)) {
            throw AppError.badRequest(
              'Some of this delivery has already been sold, so it cannot be un-received. Record a purchase return instead.',
            );
          }
          await tx.productBatch.update({
            where: { id: batch.id },
            data: { quantityReceived: { decrement: accepted.toString() } },
          });
          await recordStockMovement(tx, {
            businessId,
            productId: line.purchaseItem.productId,
            batchId: batch.id,
            reason: StockMovementReason.ADJUSTMENT,
            quantityChange: accepted.negated().toString(),
            relatedType: 'Purchase',
            relatedId: receipt.purchaseId,
            notes: `Delivery on ${receipt.purchase.invoiceNumber} undone`,
            createdByUserId: req.user!.id,
          });
        }

        await tx.purchaseItem.update({
          where: { id: line.purchaseItemId },
          data: {
            quantityReceived: { decrement: accepted.toString() },
            quantityRejected: { decrement: line.quantityRejected.toString() },
            quantityCancelled: { decrement: line.quantityCancelled.toString() },
          },
        });
      }

      await audit(tx, req, 'PurchaseReceipt', id, receipt);
      // The credit note this delivery raised for damaged or written-off goods.
      await clearArtifacts(tx, businessId, 'PurchaseReceipt', id);
      await tx.purchaseReceiptItem.deleteMany({ where: { receiptId: id } });
      await tx.purchaseReceipt.delete({ where: { id } });

      // Re-price the invoice from what is left standing against it.
      const items = await tx.purchaseItem.findMany({ where: { purchaseId: receipt.purchaseId } });
      let subtotal = new Decimal(0);
      for (const item of items) {
        const kept = new Decimal(item.quantity.toString())
          .minus(item.quantityRejected.toString())
          .minus(item.quantityCancelled.toString());
        const lineTotal = Decimal.max(
          new Decimal(0),
          kept.times(item.unitCost.toString()).minus(item.discount.toString()),
        );
        subtotal = subtotal.plus(lineTotal);
        await tx.purchaseItem.update({ where: { id: item.id }, data: { lineTotal: lineTotal.toString() } });
      }
      const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: receipt.purchaseId } });
      const total = Decimal.max(new Decimal(0), subtotal.minus(purchase.discount.toString()));
      const paid = new Decimal(purchase.amountPaid.toString());

      const settled = (i: (typeof items)[number]) =>
        new Decimal(i.quantityReceived.toString())
          .plus(i.quantityRejected.toString())
          .plus(i.quantityCancelled.toString());
      const fresh = await tx.purchaseItem.findMany({ where: { purchaseId: receipt.purchaseId } });
      const allSettled = fresh.every((i) => settled(i).gte(i.quantity.toString()));
      const anySettled = fresh.some((i) => settled(i).gt(0));

      await tx.purchase.update({
        where: { id: receipt.purchaseId },
        data: {
          subtotal: subtotal.toString(),
          total: total.toString(),
          balance: total.minus(paid).toString(),
          status: deriveStatus(total, paid),
          arrivalStatus: allSettled ? 'RECEIVED' : anySettled ? 'PARTIAL' : 'PENDING',
        },
      });
    });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/* ──────────────────── parties and products ────────────────────
   These are only removable while nothing references them. Once a farmer has
   an invoice against their name, deleting them would orphan that history —
   deactivating is the right move, and the error says so. */

adminRouter.delete('/farmers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const farmer = await tx.farmer.findFirst({ where: { id, businessId } });
      if (!farmer) throw AppError.notFound('Farmer not found');
      const [sales, payments] = await Promise.all([
        tx.sale.count({ where: { farmerId: id } }),
        tx.farmerPayment.count({ where: { farmerId: id } }),
      ]);
      if (sales > 0 || payments > 0) {
        throw AppError.badRequest(
          `${farmer.name} has ${sales} invoice(s) and ${payments} payment(s). Mark them inactive instead of deleting, so their history stays intact.`,
        );
      }
      await audit(tx, req, 'Farmer', id, farmer);
      await tx.ledgerEntry.deleteMany({ where: { businessId, partyType: 'FARMER', farmerId: id } });
      await tx.farmer.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id, businessId } });
      if (!supplier) throw AppError.notFound('Supplier not found');
      const [purchases, payments] = await Promise.all([
        tx.purchase.count({ where: { supplierId: id } }),
        tx.supplierPayment.count({ where: { supplierId: id } }),
      ]);
      if (purchases > 0 || payments > 0) {
        throw AppError.badRequest(
          `${supplier.name} has ${purchases} purchase(s) and ${payments} payment(s). Mark them inactive instead of deleting.`,
        );
      }
      await audit(tx, req, 'Supplier', id, supplier);
      await tx.ledgerEntry.deleteMany({ where: { businessId, partyType: 'SUPPLIER', supplierId: id } });
      await tx.supplier.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/products/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id, businessId } });
      if (!product) throw AppError.notFound('Product not found');
      const [sold, bought] = await Promise.all([
        tx.saleItem.count({ where: { productId: id } }),
        tx.purchaseItem.count({ where: { productId: id } }),
      ]);
      if (sold > 0 || bought > 0) {
        throw AppError.badRequest(
          `${product.name} appears on ${sold} sale(s) and ${bought} purchase(s). Mark it inactive instead of deleting.`,
        );
      }
      await audit(tx, req, 'Product', id, product);
      await tx.stockMovement.deleteMany({ where: { businessId, productId: id } });
      await tx.productBatch.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Remove a staff account entirely. Only while they have recorded nothing -
 * otherwise their name is attached to sales, stock and payments, and deleting
 * them would orphan that trail. Deactivating keeps the history.
 */
adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    if (id === req.user!.id) throw AppError.badRequest('You cannot delete your own account.');

    await runInTransaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, businessId } });
      if (!user) throw AppError.notFound('User not found');

      const [sales, purchases, expenses, products, salaries] = await Promise.all([
        tx.sale.count({ where: { createdByUserId: id } }),
        tx.purchase.count({ where: { createdByUserId: id } }),
        tx.expense.count({ where: { createdByUserId: id } }),
        tx.product.count({ where: { createdByUserId: id } }),
        tx.salaryPayment.count({ where: { userId: id } }),
      ]);
      const total = sales + purchases + expenses + products + salaries;
      if (total > 0) {
        throw AppError.badRequest(
          `${user.name} has ${total} record(s) against their name (sales, purchases, expenses, products or salary). Deactivate them instead so the trail stays intact.`,
        );
      }

      await audit(tx, req, 'User', id, { name: user.name, username: user.username, role: user.role });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.employeeAdvance.deleteMany({ where: { userId: id, settledBySalaryPaymentId: null } });
      await tx.user.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/** Lets the UI show the owner what a delete would actually remove. */
adminRouter.get('/ping', (_req, res) => res.json({ adminCapable: true }));

void prisma;
