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

export interface RecordFarmerPaymentInput {
  farmerId: number;
  accountId: number;
  amount: number;
  method: PaymentMethod;
  paymentDate?: string;
  notes?: string;
  idempotencyKey?: string;
  /** Manual allocation; omit to use the default oldest-invoice-first rule. */
  allocations?: Array<{ saleId: number; amount: number }>;
}

export async function recordFarmerPayment(businessId: number, userId: number, input: RecordFarmerPaymentInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.farmerPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return getFarmerPaymentDetail(businessId, existing.id);
  }

  const farmer = await prisma.farmer.findFirst({ where: { id: input.farmerId, businessId } });
  if (!farmer) throw AppError.notFound('Farmer not found');
  const account = await prisma.account.findFirst({ where: { id: input.accountId, businessId } });
  if (!account) throw AppError.notFound('Account not found');

  const amount = new Decimal(input.amount);
  if (amount.lte(0)) throw AppError.badRequest('Payment amount must be greater than zero');

  try {
    const payment = await runInTransaction(async (tx) => {
      let allocations: Array<{ saleId: number; amount: Prisma.Decimal }>;

      if (input.allocations && input.allocations.length > 0) {
        allocations = [];
        for (const a of input.allocations) {
          const sale = await tx.sale.findFirst({ where: { id: a.saleId, businessId, farmerId: input.farmerId } });
          if (!sale) throw AppError.badRequest(`Sale ${a.saleId} not found for this farmer`);
          const allocAmount = new Decimal(a.amount);
          if (allocAmount.gt(sale.balance.toString())) {
            throw AppError.badRequest(`Allocation for sale ${sale.invoiceNumber} exceeds its remaining balance`);
          }
          allocations.push({ saleId: sale.id, amount: allocAmount });
        }
        const sumAllocated = allocations.reduce((s, a) => s.plus(a.amount), new Decimal(0));
        if (sumAllocated.gt(amount)) throw AppError.badRequest('Allocations exceed the payment amount');
      } else {
        const outstandingSales = await tx.sale.findMany({
          where: { businessId, farmerId: input.farmerId, status: { in: [DocumentStatus.UNPAID, DocumentStatus.PARTIALLY_PAID] } },
          orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
        });
        const { allocations: auto } = allocateOldestFirst(
          outstandingSales.map((s) => ({ id: s.id, balance: s.balance })),
          amount,
        );
        allocations = auto.map((a) => ({ saleId: a.invoiceId, amount: a.amount }));
      }

      const created = await tx.farmerPayment.create({
        data: {
          businessId,
          farmerId: input.farmerId,
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
        await tx.farmerPaymentAllocation.create({
          data: { farmerPaymentId: created.id, saleId: alloc.saleId, allocatedAmount: alloc.amount.toString() },
        });
        const sale = await tx.sale.findUniqueOrThrow({ where: { id: alloc.saleId } });
        const newAmountPaid = new Decimal(sale.amountPaid.toString()).plus(alloc.amount);
        const newBalance = new Decimal(sale.balance.toString()).minus(alloc.amount);
        await tx.sale.update({
          where: { id: alloc.saleId },
          data: {
            amountPaid: newAmountPaid.toString(),
            balance: newBalance.toString(),
            status: deriveStatusFromBalance(newBalance, newAmountPaid),
          },
        });
      }

      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.FARMER,
        farmerId: input.farmerId,
        direction: LedgerDirection.CREDIT,
        amount,
        relatedType: 'FarmerPayment',
        relatedId: created.id,
        description: input.notes ?? 'Payment received from farmer',
      });

      await recordAccountTransaction(tx, {
        businessId,
        accountId: input.accountId,
        direction: LedgerDirection.CREDIT,
        amount,
        relatedType: 'FarmerPayment',
        relatedId: created.id,
        description: `Payment from ${farmer.name}`,
      });

      await writeAuditLog(tx, {
        businessId,
        userId,
        action: 'CREATE',
        entityType: 'FarmerPayment',
        entityId: created.id,
        afterData: { amount: amount.toString(), farmerId: input.farmerId },
      });

      return created;
    });

    return getFarmerPaymentDetail(businessId, payment.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.idempotencyKey) {
      const existing = await prisma.farmerPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return getFarmerPaymentDetail(businessId, existing.id);
    }
    throw err;
  }
}

export async function getFarmerPaymentDetail(businessId: number, id: number) {
  const payment = await prisma.farmerPayment.findFirst({
    where: { id, businessId },
    include: { farmer: true, account: true, allocations: { include: { sale: true } } },
  });
  if (!payment) throw AppError.notFound('Payment not found');
  return payment;
}

export async function listFarmerPayments(businessId: number, farmerId?: number) {
  return prisma.farmerPayment.findMany({
    where: { businessId, ...(farmerId ? { farmerId } : {}) },
    include: { farmer: true, account: true, allocations: true },
    orderBy: { paymentDate: 'desc' },
  });
}
