import { DocumentStatus, LedgerDirection, PartyType, Prisma, PaymentMethod } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { recordLedgerEntry } from '../../lib/ledger';
import { recordAccountTransaction } from '../../lib/accountLedger';
import { allocateOldestFirst } from '../../lib/paymentAllocation';
import { deriveStatusFromBalance } from '../../lib/invoiceStatus';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';

const Decimal = Prisma.Decimal;

export interface RecordSupplierPaymentInput {
  supplierId: number;
  accountId: number;
  amount: number;
  method: PaymentMethod;
  paymentDate?: string;
  notes?: string;
  idempotencyKey?: string;
  allocations?: Array<{ purchaseId: number; amount: number }>;
}

export async function recordSupplierPayment(businessId: number, userId: number, input: RecordSupplierPaymentInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.supplierPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return getSupplierPaymentDetail(businessId, existing.id);
  }

  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, businessId } });
  if (!supplier) throw AppError.notFound('Supplier not found');
  const account = await prisma.account.findFirst({ where: { id: input.accountId, businessId } });
  if (!account) throw AppError.notFound('Account not found');

  const amount = new Decimal(input.amount);
  if (amount.lte(0)) throw AppError.badRequest('Payment amount must be greater than zero');

  try {
    const payment = await runInTransaction(async (tx) => {
      let allocations: Array<{ purchaseId: number; amount: Prisma.Decimal }>;

      if (input.allocations && input.allocations.length > 0) {
        allocations = [];
        for (const a of input.allocations) {
          const purchase = await tx.purchase.findFirst({ where: { id: a.purchaseId, businessId, supplierId: input.supplierId } });
          if (!purchase) throw AppError.badRequest(`Purchase ${a.purchaseId} not found for this supplier`);
          const allocAmount = new Decimal(a.amount);
          if (allocAmount.gt(purchase.balance.toString())) {
            throw AppError.badRequest(`Allocation for purchase ${purchase.invoiceNumber} exceeds its remaining balance`);
          }
          allocations.push({ purchaseId: purchase.id, amount: allocAmount });
        }
        const sumAllocated = allocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
        if (sumAllocated.gt(amount)) throw AppError.badRequest('Allocations exceed the payment amount');
      } else {
        const outstandingPurchases = await tx.purchase.findMany({
          where: { businessId, supplierId: input.supplierId, status: { in: [DocumentStatus.UNPAID, DocumentStatus.PARTIALLY_PAID] } },
          orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
        });
        const { allocations: auto } = allocateOldestFirst(
          outstandingPurchases.map((p) => ({ id: p.id, balance: p.balance })),
          amount,
        );
        allocations = auto.map((a) => ({ purchaseId: a.invoiceId, amount: a.amount }));
      }

      const created = await tx.supplierPayment.create({
        data: {
          businessId,
          supplierId: input.supplierId,
          accountId: input.accountId,
          amount: amount.toString(),
          method: input.method,
          paymentDate: input.paymentDate ? new Date(input.paymentDate) : new Date(),
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdByUserId: userId,
        },
      });

      for (const alloc of allocations) {
        if (alloc.amount.lte(0)) continue;
        await tx.supplierPaymentAllocation.create({
          data: { supplierPaymentId: created.id, purchaseId: alloc.purchaseId, allocatedAmount: alloc.amount.toString() },
        });
        const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: alloc.purchaseId } });
        const newAmountPaid = new Decimal(purchase.amountPaid.toString()).plus(alloc.amount);
        const newBalance = new Decimal(purchase.balance.toString()).minus(alloc.amount);
        await tx.purchase.update({
          where: { id: alloc.purchaseId },
          data: {
            amountPaid: newAmountPaid.toString(),
            balance: newBalance.toString(),
            status: deriveStatusFromBalance(newBalance, newAmountPaid),
          },
        });
      }

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.SUPPLIER,
        supplierId: input.supplierId,
        direction: LedgerDirection.CREDIT,
        amount,
        relatedType: 'SupplierPayment',
        relatedId: created.id,
        description: input.notes ?? 'Payment made to supplier',
      });

      await recordAccountTransaction(tx, {
        businessId,
        accountId: input.accountId,
        direction: LedgerDirection.DEBIT,
        amount,
        relatedType: 'SupplierPayment',
        relatedId: created.id,
        description: `Payment to ${supplier.name}`,
      });

      await writeAuditLog(tx, {
        businessId,
        userId,
        action: 'CREATE',
        entityType: 'SupplierPayment',
        entityId: created.id,
        afterData: { amount: amount.toString(), supplierId: input.supplierId },
      });

      return created;
    });

    return getSupplierPaymentDetail(businessId, payment.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.idempotencyKey) {
      const existing = await prisma.supplierPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return getSupplierPaymentDetail(businessId, existing.id);
    }
    throw err;
  }
}

export async function getSupplierPaymentDetail(businessId: number, id: number) {
  const payment = await prisma.supplierPayment.findFirst({
    where: { id, businessId },
    include: { supplier: true, account: true, allocations: { include: { purchase: true } } },
  });
  if (!payment) throw AppError.notFound('Payment not found');
  return payment;
}

export async function listSupplierPayments(businessId: number, supplierId?: number) {
  return prisma.supplierPayment.findMany({
    where: { businessId, ...(supplierId ? { supplierId } : {}) },
    include: { supplier: true, account: true, allocations: true },
    orderBy: { paymentDate: 'desc' },
  });
}
