import {
  ArrivalStatus,
  DocumentStatus,
  LedgerDirection,
  PartyType,
  Prisma,
  SequenceType,
  StockMovementReason,
  PaymentMethod,
} from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { recordStockMovement } from '../../lib/stock';
import { recordLedgerEntry } from '../../lib/ledger';
import { assertSufficientFunds, recordAccountTransaction } from '../../lib/accountLedger';
import { nextInvoiceNumber } from '../../lib/invoiceNumber';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { deriveStatus } from '../../lib/invoiceStatus';
import { parseBusinessDate } from '../../lib/dates';

const Decimal = Prisma.Decimal;

export interface PurchaseItemInput {
  productId: number;
  quantity: number;
  unitCost: number;
  discount?: number;
  batchNumber?: string;
  manufactureDate?: string;
  expiryDate?: string;
}

export interface CreatePurchaseInput {
  supplierId: number;
  /**
   * True when this is an order placed with the supplier and the goods are not
   * in the shop yet. The invoice, the payable and any advance payment are all
   * recorded now; the stock is not, and only appears when arrival is
   * confirmed. False (the default) keeps the old behaviour of a
   * cash-and-carry pickup where the goods came back with the invoice.
   */
  isOrder?: boolean;
  expectedArrivalDate?: string;
  supplierInvoiceNumber?: string;
  invoiceDate: string;
  dueDate?: string;
  discount?: number;
  notes?: string;
  items: PurchaseItemInput[];
  initialPayment?: { accountId: number; amount: number; method: PaymentMethod; notes?: string };
}

export async function createPurchase(businessId: number, userId: number, input: CreatePurchaseInput) {
  if (input.items.length === 0) throw AppError.badRequest('A purchase needs at least one item');

  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, businessId } });
  if (!supplier) throw AppError.notFound('Supplier not found');

  const products = await prisma.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, businessId },
  });
  if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
    throw AppError.badRequest('One or more products were not found');
  }

  const itemTotals = input.items.map((item) => {
    const lineTotal = new Decimal(item.quantity).times(item.unitCost).minus(item.discount ?? 0);
    return { ...item, lineTotal };
  });
  const subtotal = itemTotals.reduce((sum, i) => sum.plus(i.lineTotal), new Decimal(0));
  const invoiceDiscount = new Decimal(input.discount ?? 0);
  const total = subtotal.minus(invoiceDiscount);
  if (total.lt(0)) throw AppError.badRequest('Total cannot be negative');

  const initialPaymentAmount = new Decimal(input.initialPayment?.amount ?? 0);
  if (initialPaymentAmount.gt(total)) {
    throw AppError.badRequest('Initial payment cannot exceed the invoice total');
  }

  const isOrder = input.isOrder === true;

  const purchase = await runInTransaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx, businessId, SequenceType.PURCHASE);

    const created = await tx.purchase.create({
      data: {
        businessId,
        supplierId: input.supplierId,
        invoiceNumber,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        invoiceDate: parseBusinessDate(input.invoiceDate),
        dueDate: input.dueDate ? parseBusinessDate(input.dueDate) : null,
        subtotal: subtotal.toString(),
        discount: invoiceDiscount.toString(),
        total: total.toString(),
        amountPaid: '0',
        balance: total.toString(),
        status: DocumentStatus.UNPAID,
        arrivalStatus: isOrder ? ArrivalStatus.PENDING : ArrivalStatus.RECEIVED,
        expectedArrivalDate: input.expectedArrivalDate ? parseBusinessDate(input.expectedArrivalDate) : null,
        notes: input.notes,
        createdByUserId: userId,
      },
    });

    // Goods that came back with the invoice are logged as a delivery too, so
    // every rupee of stock in the system traces to a receipt either way.
    const receipt = isOrder
      ? null
      : await tx.purchaseReceipt.create({
          data: {
            businessId,
            purchaseId: created.id,
            receivedDate: parseBusinessDate(input.invoiceDate),
            notes: 'Collected with the invoice',
            createdByUserId: userId,
          },
        });

    for (const item of itemTotals) {
      const batch = await tx.productBatch.create({
        data: {
          productId: item.productId,
          batchNumber: item.batchNumber,
          supplierId: input.supplierId,
          manufactureDate: item.manufactureDate ? new Date(item.manufactureDate) : null,
          expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
          purchaseCost: item.unitCost,
          // For an order nothing has arrived yet, so the batch starts empty
          // and fills up as deliveries are confirmed.
          quantityReceived: isOrder ? 0 : item.quantity,
          // Starts at 0, not item.quantity: recordStockMovement below is the
          // sole writer of quantityRemaining (see lib/stock.ts) so it stays
          // reconstructable from StockMovement history alone.
          quantityRemaining: 0,
        },
      });

      const purchaseItem = await tx.purchaseItem.create({
        data: {
          purchaseId: created.id,
          productId: item.productId,
          batchId: batch.id,
          quantity: item.quantity,
          unitCost: item.unitCost,
          discount: item.discount ?? 0,
          lineTotal: item.lineTotal.toString(),
          quantityReceived: isOrder ? 0 : item.quantity,
        },
      });

      if (!isOrder) {
        await tx.purchaseReceiptItem.create({
          data: {
            receiptId: receipt!.id,
            purchaseItemId: purchaseItem.id,
            quantityAccepted: item.quantity,
          },
        });

        await recordStockMovement(tx, {
          businessId,
          productId: item.productId,
          batchId: batch.id,
          reason: StockMovementReason.PURCHASE,
          quantityChange: item.quantity,
          relatedType: 'Purchase',
          relatedId: created.id,
          createdByUserId: userId,
        });
      }

      await tx.product.update({
        where: { id: item.productId },
        data: { lastPurchaseCost: item.unitCost },
      });
    }

    await recordLedgerEntry(tx, {
      businessId,
      partyType: PartyType.SUPPLIER,
      supplierId: input.supplierId,
      direction: LedgerDirection.DEBIT,
      amount: total,
      relatedType: 'Purchase',
      relatedId: created.id,
      description: `Purchase ${invoiceNumber}`,
      entryDate: created.invoiceDate,
    });

    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'CREATE',
      entityType: 'Purchase',
      entityId: created.id,
      afterData: {
        invoiceNumber,
        total: total.toString(),
        supplierId: input.supplierId,
        arrivalStatus: isOrder ? 'PENDING' : 'RECEIVED',
      },
    });

    let finalPurchase = created;

    if (initialPaymentAmount.gt(0) && input.initialPayment) {
      const account = await tx.account.findFirst({
        where: { id: input.initialPayment.accountId, businessId },
      });
      if (!account) throw AppError.notFound('Account not found');

      const payment = await tx.supplierPayment.create({
        data: {
          businessId,
          supplierId: input.supplierId,
          accountId: input.initialPayment.accountId,
          amount: initialPaymentAmount.toString(),
          method: input.initialPayment.method,
          notes: input.initialPayment.notes ?? `Initial payment on purchase ${invoiceNumber}`,
          createdByUserId: userId,
        },
      });
      await tx.supplierPaymentAllocation.create({
        data: { supplierPaymentId: payment.id, purchaseId: created.id, allocatedAmount: initialPaymentAmount.toString() },
      });

      finalPurchase = await tx.purchase.update({
        where: { id: created.id },
        data: {
          amountPaid: initialPaymentAmount.toString(),
          balance: total.minus(initialPaymentAmount).toString(),
          status: deriveStatus(total, initialPaymentAmount),
        },
      });

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.SUPPLIER,
        supplierId: input.supplierId,
        direction: LedgerDirection.CREDIT,
        amount: initialPaymentAmount,
        relatedType: 'SupplierPayment',
        relatedId: payment.id,
        description: `Payment on purchase ${invoiceNumber}`,
        entryDate: created.invoiceDate,
      });

      await assertSufficientFunds(tx, input.initialPayment.accountId, initialPaymentAmount, 'payment');
      await recordAccountTransaction(tx, {
        businessId,
        accountId: input.initialPayment.accountId,
        direction: LedgerDirection.DEBIT,
        amount: initialPaymentAmount,
        relatedType: 'SupplierPayment',
        relatedId: payment.id,
        description: `Payment on purchase ${invoiceNumber}`,
        // Cash follows the invoice date, not the moment of data entry.
        txnDate: created.invoiceDate,
      });
    }

    return finalPurchase;
  });

  return getPurchaseDetail(businessId, purchase.id);
}

export async function getPurchaseDetail(businessId: number, id: number) {
  const purchase = await prisma.purchase.findFirst({
    where: { id, businessId },
    include: {
      supplier: true,
      items: { include: { product: true, batch: true } },
      returns: { include: { items: true } },
      receipts: {
        include: { items: { include: { purchaseItem: { select: { productId: true } } } } },
        orderBy: { receivedDate: 'desc' },
      },
      paymentAllocations: { include: { supplierPayment: true } },
    },
  });
  if (!purchase) throw AppError.notFound('Purchase not found');
  return purchase;
}

export interface ListPurchasesFilters {
  supplierId?: number;
  status?: DocumentStatus;
  arrivalStatus?: ArrivalStatus;
  from?: string;
  to?: string;
  q?: string;
}

export async function listPurchases(businessId: number, filters: ListPurchasesFilters) {
  return prisma.purchase.findMany({
    where: {
      businessId,
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.arrivalStatus ? { arrivalStatus: filters.arrivalStatus } : {}),
      ...(filters.from || filters.to
        ? {
            invoiceDate: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
      ...(filters.q
        ? { OR: [{ invoiceNumber: { contains: filters.q } }, { supplierInvoiceNumber: { contains: filters.q } }] }
        : {}),
    },
    include: {
      supplier: true,
      // The list shows "3 of 10 arrived", so it needs the per-line counters.
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitCost: true,
          quantityReceived: true,
          quantityRejected: true,
          quantityCancelled: true,
          product: { select: { name: true, unit: true } },
        },
      },
    },
    orderBy: { invoiceDate: 'desc' },
  });
}

/* ───────────────────────── order arrival ───────────────────────── */

export interface ReceiveItemInput {
  purchaseItemId: number;
  /** Good stock that goes on the shelf. */
  quantityAccepted: number;
  /** Arrived damaged, short or refused: credited off the invoice, never stocked. */
  quantityRejected?: number;
  /** Learned on delivery more often than at order time. */
  expiryDate?: string;
  batchNumber?: string;
  notes?: string;
}

export interface ReceivePurchaseInput {
  receivedDate?: string;
  notes?: string;
  /** Write off whatever still has not arrived - the supplier is not sending it. */
  closeOrder?: boolean;
  /** Same key on a retry returns the first receipt instead of stocking twice. */
  idempotencyKey?: string;
  items: ReceiveItemInput[];
}

/** What a line still has coming: ordered, less everything already settled. */
function outstandingOf(item: {
  quantity: Prisma.Decimal;
  quantityReceived: Prisma.Decimal;
  quantityRejected: Prisma.Decimal;
  quantityCancelled: Prisma.Decimal;
}): Prisma.Decimal {
  return new Decimal(item.quantity.toString())
    .minus(item.quantityReceived.toString())
    .minus(item.quantityRejected.toString())
    .minus(item.quantityCancelled.toString());
}

function arrivalStatusFor(
  items: Array<{
    quantity: Prisma.Decimal;
    quantityReceived: Prisma.Decimal;
    quantityRejected: Prisma.Decimal;
    quantityCancelled: Prisma.Decimal;
  }>,
): ArrivalStatus {
  const anySettled = items.some(
    (i) =>
      new Decimal(i.quantityReceived.toString()).gt(0) ||
      new Decimal(i.quantityRejected.toString()).gt(0) ||
      new Decimal(i.quantityCancelled.toString()).gt(0),
  );
  const allSettled = items.every((i) => outstandingOf(i).lte(0));
  if (allSettled) return ArrivalStatus.RECEIVED;
  return anySettled ? ArrivalStatus.PARTIAL : ArrivalStatus.PENDING;
}

/**
 * Confirm that an order (or part of one) has physically arrived.
 *
 * This is the only place ordered goods become stock. Three quantities can come
 * out of a delivery and they are deliberately kept apart:
 *
 *   accepted  - goes on the shelf, so a StockMovement is written
 *   rejected  - damaged or short; never stocked, and credited off the invoice
 *   cancelled - the rest of an order being closed; same treatment as rejected
 *
 * Rejected and cancelled quantities post a CREDIT against the supplier, so the
 * payable drops to what is actually owed for goods actually received. The
 * invoice totals are rewritten to match, which keeps `total = sum of lines` and
 * stops Profit & Loss charging for goods that never turned up.
 */
export async function receivePurchase(
  businessId: number,
  userId: number,
  purchaseId: number,
  input: ReceivePurchaseInput,
) {
  await runInTransaction(async (tx) => {
    // A repeated click sends the same key: hand back the first result rather
    // than adding the stock a second time.
    if (input.idempotencyKey) {
      const existing = await tx.purchaseReceipt.findFirst({
        where: { businessId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return;
    }

    const purchase = await tx.purchase.findFirst({
      where: { id: purchaseId, businessId },
      include: { items: true },
    });
    if (!purchase) throw AppError.notFound('Purchase not found');
    if (purchase.status === DocumentStatus.VOID) {
      throw AppError.badRequest('This purchase has been voided.');
    }
    if (purchase.arrivalStatus === ArrivalStatus.RECEIVED) {
      throw AppError.conflict('Everything on this order has already been accounted for.');
    }

    const receipt = await tx.purchaseReceipt.create({
      data: {
        businessId,
        purchaseId,
        receivedDate: input.receivedDate ? parseBusinessDate(input.receivedDate) : new Date(),
        notes: input.notes,
        closedOrder: input.closeOrder === true,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: userId,
      },
    });

    const byId = new Map(purchase.items.map((i) => [i.id, i]));
    /** Value of everything that will never reach the shelf, to credit back. */
    let creditValue = new Decimal(0);

    for (const line of input.items) {
      const item = byId.get(line.purchaseItemId);
      if (!item) throw AppError.badRequest('That item is not on this purchase.');

      const accepted = new Decimal(line.quantityAccepted ?? 0);
      const rejected = new Decimal(line.quantityRejected ?? 0);
      if (accepted.lt(0) || rejected.lt(0)) throw AppError.badRequest('Quantities cannot be negative.');
      if (accepted.plus(rejected).lte(0)) continue;

      const outstanding = outstandingOf(item);
      if (accepted.plus(rejected).gt(outstanding)) {
        throw AppError.badRequest(
          `Only ${outstanding.toFixed(2)} of that product is still due on this order - ` +
            `you entered ${accepted.plus(rejected).toFixed(2)}.`,
        );
      }

      await tx.purchaseReceiptItem.create({
        data: {
          receiptId: receipt.id,
          purchaseItemId: item.id,
          quantityAccepted: accepted.toString(),
          quantityRejected: rejected.toString(),
          notes: line.notes,
        },
      });

      if (accepted.gt(0) && item.batchId) {
        // The expiry is usually only legible once the carton is in your hand.
        await tx.productBatch.update({
          where: { id: item.batchId },
          data: {
            quantityReceived: { increment: accepted.toString() },
            ...(line.expiryDate ? { expiryDate: parseBusinessDate(line.expiryDate) } : {}),
            ...(line.batchNumber ? { batchNumber: line.batchNumber } : {}),
          },
        });

        await recordStockMovement(tx, {
          businessId,
          productId: item.productId,
          batchId: item.batchId,
          reason: StockMovementReason.PURCHASE,
          quantityChange: accepted.toString(),
          relatedType: 'Purchase',
          relatedId: purchaseId,
          notes: `Arrived ${purchase.invoiceNumber}`,
          createdByUserId: userId,
        });
      }

      await tx.purchaseItem.update({
        where: { id: item.id },
        data: {
          quantityReceived: { increment: accepted.toString() },
          quantityRejected: { increment: rejected.toString() },
        },
      });

      creditValue = creditValue.plus(rejected.times(item.unitCost.toString()));
      // Keep the in-memory copy in step so outstanding stays right if the same
      // line appears twice in one payload.
      item.quantityReceived = new Decimal(item.quantityReceived.toString()).plus(accepted) as Prisma.Decimal;
      item.quantityRejected = new Decimal(item.quantityRejected.toString()).plus(rejected) as Prisma.Decimal;
    }

    if (input.closeOrder) {
      for (const item of purchase.items) {
        const remaining = outstandingOf(item);
        if (remaining.lte(0)) continue;
        await tx.purchaseReceiptItem.create({
          data: {
            receiptId: receipt.id,
            purchaseItemId: item.id,
            quantityAccepted: '0',
            quantityCancelled: remaining.toString(),
            notes: 'Order closed - not supplied',
          },
        });
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { quantityCancelled: { increment: remaining.toString() } },
        });
        creditValue = creditValue.plus(remaining.times(item.unitCost.toString()));
        item.quantityCancelled = new Decimal(item.quantityCancelled.toString()).plus(remaining) as Prisma.Decimal;
      }
    }

    // --- money: credit back anything that will never reach the shelf ---
    if (creditValue.gt(0)) {
      const newSubtotal = Decimal.max(new Decimal(0), new Decimal(purchase.subtotal.toString()).minus(creditValue));
      const newTotal = Decimal.max(new Decimal(0), newSubtotal.minus(purchase.discount.toString()));
      const paid = new Decimal(purchase.amountPaid.toString());

      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          subtotal: newSubtotal.toString(),
          total: newTotal.toString(),
          balance: newTotal.minus(paid).toString(),
          status: deriveStatus(newTotal, paid),
        },
      });

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.SUPPLIER,
        supplierId: purchase.supplierId,
        direction: LedgerDirection.CREDIT,
        amount: creditValue,
        relatedType: 'PurchaseReceipt',
        relatedId: receipt.id,
        description: `Short or damaged on ${purchase.invoiceNumber}`,
        entryDate: receipt.receivedDate,
      });

      // Each line is re-priced to what was actually kept, so the invoice still
      // adds up to the sum of its own lines.
      for (const item of purchase.items) {
        const kept = new Decimal(item.quantity.toString())
          .minus(item.quantityRejected.toString())
          .minus(item.quantityCancelled.toString());
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: {
            lineTotal: Decimal.max(
              new Decimal(0),
              kept.times(item.unitCost.toString()).minus(item.discount.toString()),
            ).toString(),
          },
        });
      }
    }

    const freshItems = await tx.purchaseItem.findMany({ where: { purchaseId } });
    await tx.purchase.update({
      where: { id: purchaseId },
      data: { arrivalStatus: arrivalStatusFor(freshItems) },
    });

    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'UPDATE',
      entityType: 'PurchaseReceipt',
      entityId: receipt.id,
      afterData: {
        purchase: purchase.invoiceNumber,
        closedOrder: input.closeOrder === true,
        creditedBack: creditValue.toFixed(2),
      },
    });
  });

  return getPurchaseDetail(businessId, purchaseId);
}

/** Every delivery logged against a purchase, newest first. */
export async function listPurchaseReceipts(businessId: number, purchaseId: number) {
  return prisma.purchaseReceipt.findMany({
    where: { businessId, purchaseId },
    include: { items: { include: { purchaseItem: { include: { product: true } } } } },
    orderBy: { receivedDate: 'desc' },
  });
}
