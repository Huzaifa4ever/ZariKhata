import { DocumentStatus, LedgerDirection, PartyType, Prisma, SequenceType, StockMovementReason, PaymentMethod } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { recordStockMovement } from '../../lib/stock';
import { recordLedgerEntry } from '../../lib/ledger';
import { recordAccountTransaction } from '../../lib/accountLedger';
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
        notes: input.notes,
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
          quantityReceived: item.quantity,
          // Starts at 0, not item.quantity: recordStockMovement below is the
          // sole writer of quantityRemaining (see lib/stock.ts) so it stays
          // reconstructable from StockMovement history alone.
          quantityRemaining: 0,
        },
      });

      await tx.purchaseItem.create({
        data: {
          purchaseId: created.id,
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
        relatedId: created.id,
        createdByUserId: userId,
      });

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
      afterData: { invoiceNumber, total: total.toString(), supplierId: input.supplierId },
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
      });

      await recordAccountTransaction(tx, {
        businessId,
        accountId: input.initialPayment.accountId,
        direction: LedgerDirection.DEBIT,
        amount: initialPaymentAmount,
        relatedType: 'SupplierPayment',
        relatedId: payment.id,
        description: `Payment on purchase ${invoiceNumber}`,
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
      paymentAllocations: { include: { supplierPayment: true } },
    },
  });
  if (!purchase) throw AppError.notFound('Purchase not found');
  return purchase;
}

export interface ListPurchasesFilters {
  supplierId?: number;
  status?: DocumentStatus;
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
    include: { supplier: true },
    orderBy: { invoiceDate: 'desc' },
  });
}
