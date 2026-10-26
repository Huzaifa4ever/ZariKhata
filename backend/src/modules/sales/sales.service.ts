import { DocumentStatus, LedgerDirection, PartyType, Prisma, SequenceType, PaymentMethod } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { consumeBatchesFifo } from '../../lib/fifoBatches';
import { recordLedgerEntry } from '../../lib/ledger';
import { recordAccountTransaction } from '../../lib/accountLedger';
import { nextInvoiceNumber } from '../../lib/invoiceNumber';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { deriveStatus } from '../../lib/invoiceStatus';
import { parseBusinessDate } from '../../lib/dates';

const Decimal = Prisma.Decimal;

export interface SaleItemInput {
  productId: number;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface CreateSaleInput {
  farmerId?: number | null;
  customerName?: string;
  invoiceDate: string;
  dueDate?: string;
  discount?: number;
  notes?: string;
  items: SaleItemInput[];
  initialPayment?: { accountId: number; amount: number; method: PaymentMethod; notes?: string };
}

export async function createSale(businessId: number, userId: number, input: CreateSaleInput) {
  if (input.items.length === 0) throw AppError.badRequest('A sale needs at least one item');

  // A walk-in sale has no farmer. Only validate one when it was actually given.
  const farmer = input.farmerId
    ? await prisma.farmer.findFirst({ where: { id: input.farmerId, businessId } })
    : null;
  if (input.farmerId && !farmer) throw AppError.notFound('Farmer not found');

  const products = await prisma.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, businessId },
  });
  if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
    throw AppError.badRequest('One or more products were not found');
  }

  const lineTotals = input.items.map((item) => ({
    ...item,
    lineTotal: new Decimal(item.quantity).times(item.unitPrice).minus(item.discount ?? 0),
  }));
  const subtotal = lineTotals.reduce((sum, i) => sum.plus(i.lineTotal), new Decimal(0));
  const invoiceDiscount = new Decimal(input.discount ?? 0);
  const total = subtotal.minus(invoiceDiscount);
  if (total.lt(0)) throw AppError.badRequest('Total cannot be negative');

  const initialPaymentAmount = new Decimal(input.initialPayment?.amount ?? 0);
  if (initialPaymentAmount.gt(total)) {
    throw AppError.badRequest('Initial payment cannot exceed the invoice total');
  }

  const sale = await runInTransaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx, businessId, SequenceType.SALE);

    const created = await tx.sale.create({
      data: {
        businessId,
        farmerId: farmer ? farmer.id : null,
        customerName: farmer ? null : input.customerName?.trim() || null,
        invoiceNumber,
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

    for (const item of lineTotals) {
      // Overselling is rejected here: consumeBatchesFifo throws a conflict
      // if total remaining stock across all batches is less than requested,
      // and the row lock it takes on Product serializes two concurrent
      // sales of the same product so they can't both succeed against stock
      // that only covers one of them.
      const { consumed, weightedUnitCost } = await consumeBatchesFifo(tx, {
        businessId,
        productId: item.productId,
        quantity: item.quantity,
        relatedType: 'Sale',
        relatedId: created.id,
        createdByUserId: userId,
      });

      await tx.saleItem.create({
        data: {
          saleId: created.id,
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

    // Only a registered farmer has a running account. A walk-in owes nothing
    // on credit, so posting a ledger entry for them would invent a debtor.
    if (farmer) {
      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.FARMER,
        farmerId: farmer.id,
        direction: LedgerDirection.DEBIT,
        amount: total,
        relatedType: 'Sale',
        relatedId: created.id,
        description: `Sale ${invoiceNumber}`,
        entryDate: created.invoiceDate,
      });
    }

    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'CREATE',
      entityType: 'Sale',
      entityId: created.id,
      afterData: { invoiceNumber, total: total.toString(), farmerId: farmer?.id ?? null, customerName: input.customerName ?? null },
    });

    let finalSale = created;

    if (initialPaymentAmount.gt(0) && input.initialPayment) {
      const account = await tx.account.findFirst({ where: { id: input.initialPayment.accountId, businessId } });
      if (!account) throw AppError.notFound('Account not found');

      // A registered farmer gets a FarmerPayment allocated to the invoice so
      // it shows on their statement. A walk-in has no statement, so the money
      // is booked straight to the account against the sale itself.
      if (farmer) {
        const payment = await tx.farmerPayment.create({
          data: {
            businessId,
            farmerId: farmer.id,
            accountId: input.initialPayment.accountId,
            amount: initialPaymentAmount.toString(),
            method: input.initialPayment.method,
            notes: input.initialPayment.notes ?? `Initial payment on sale ${invoiceNumber}`,
            createdByUserId: userId,
          },
        });
        await tx.farmerPaymentAllocation.create({
          data: { farmerPaymentId: payment.id, saleId: created.id, allocatedAmount: initialPaymentAmount.toString() },
        });
        await recordLedgerEntry(tx, {
          businessId,
          partyType: PartyType.FARMER,
          farmerId: farmer.id,
          direction: LedgerDirection.CREDIT,
          amount: initialPaymentAmount,
          relatedType: 'FarmerPayment',
          relatedId: payment.id,
          description: `Payment on sale ${invoiceNumber}`,
        });
        await recordAccountTransaction(tx, {
          businessId,
          accountId: input.initialPayment.accountId,
          direction: LedgerDirection.CREDIT,
          amount: initialPaymentAmount,
          relatedType: 'FarmerPayment',
          relatedId: payment.id,
          description: `Payment on sale ${invoiceNumber}`,
        });
      } else {
        await recordAccountTransaction(tx, {
          businessId,
          accountId: input.initialPayment.accountId,
          direction: LedgerDirection.CREDIT,
          amount: initialPaymentAmount,
          relatedType: 'Sale',
          relatedId: created.id,
          description: `Counter sale ${invoiceNumber}`,
        });
      }

      finalSale = await tx.sale.update({
        where: { id: created.id },
        data: {
          amountPaid: initialPaymentAmount.toString(),
          balance: total.minus(initialPaymentAmount).toString(),
          status: deriveStatus(total, initialPaymentAmount),
        },
      });
    }

    return finalSale;
  });

  return getSaleDetail(businessId, sale.id);
}

export async function getSaleDetail(businessId: number, id: number) {
  const sale = await prisma.sale.findFirst({
    where: { id, businessId },
    include: {
      farmer: true,
      items: { include: { product: true, batch: true } },
      returns: { include: { items: true } },
      paymentAllocations: { include: { farmerPayment: true } },
    },
  });
  if (!sale) throw AppError.notFound('Sale not found');
  return sale;
}

export interface ListSalesFilters {
  farmerId?: number;
  status?: DocumentStatus;
  from?: string;
  to?: string;
  q?: string;
}

export async function listSales(businessId: number, filters: ListSalesFilters) {
  return prisma.sale.findMany({
    where: {
      businessId,
      ...(filters.farmerId ? { farmerId: filters.farmerId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to
        ? {
            invoiceDate: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
      ...(filters.q ? { invoiceNumber: { contains: filters.q } } : {}),
    },
    include: { farmer: true },
    orderBy: { invoiceDate: 'desc' },
  });
}
