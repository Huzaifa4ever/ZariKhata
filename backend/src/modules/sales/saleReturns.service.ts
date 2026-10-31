import { LedgerDirection, PartyType, Prisma, ReturnCondition, SequenceType, StockMovementReason } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { recordStockMovement } from '../../lib/stock';
import { recordLedgerEntry } from '../../lib/ledger';
import { assertSufficientFunds, recordAccountTransaction } from '../../lib/accountLedger';
import { nextInvoiceNumber } from '../../lib/invoiceNumber';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { deriveStatusFromBalance } from '../../lib/invoiceStatus';

const Decimal = Prisma.Decimal;

export interface SaleReturnItemInput {
  saleItemId: number;
  quantity: number;
  condition?: ReturnCondition;
}

export interface CreateSaleReturnInput {
  saleId: number;
  reason?: string;
  items: SaleReturnItemInput[];
  /** If set, the credit is paid back out in cash/bank immediately instead of just reducing what the farmer owes. */
  cashRefundAccountId?: number;
}

export async function createSaleReturn(businessId: number, userId: number, input: CreateSaleReturnInput) {
  if (input.items.length === 0) throw AppError.badRequest('A return needs at least one item');

  const sale = await prisma.sale.findFirst({ where: { id: input.saleId, businessId }, include: { items: true } });
  if (!sale) throw AppError.notFound('Sale not found');
  if (sale.status === 'VOID') throw AppError.badRequest('Cannot return items on a voided sale');

  return runInTransaction(async (tx) => {
    const returnNumber = await nextInvoiceNumber(tx, businessId, SequenceType.SALE_RETURN);
    const saleReturn = await tx.saleReturn.create({
      data: { businessId, saleId: sale.id, returnNumber, reason: input.reason, totalAmount: '0' },
    });

    let totalAmount = new Decimal(0);

    for (const reqItem of input.items) {
      const saleItem = sale.items.find((i) => i.id === reqItem.saleItemId);
      if (!saleItem) throw AppError.badRequest('Sale item not found on this invoice');

      const alreadyReturned = await tx.saleReturnItem.aggregate({
        where: { saleItemId: saleItem.id },
        _sum: { quantity: true },
      });
      const previouslyReturned = new Decimal(alreadyReturned._sum.quantity?.toString() ?? 0);
      const eligible = new Decimal(saleItem.quantity.toString()).minus(previouslyReturned);
      const requested = new Decimal(reqItem.quantity);
      if (requested.gt(eligible)) {
        throw AppError.conflict('Return quantity exceeds what remains returnable for this item', {
          saleItemId: saleItem.id,
          eligible: eligible.toFixed(3),
        });
      }

      const condition = reqItem.condition ?? ReturnCondition.SALEABLE;
      const restocked = condition === ReturnCondition.SALEABLE;
      const lineTotal = requested.times(saleItem.unitPrice.toString());
      totalAmount = totalAmount.plus(lineTotal);

      await tx.saleReturnItem.create({
        data: {
          saleReturnId: saleReturn.id,
          saleItemId: saleItem.id,
          productId: saleItem.productId,
          quantity: requested.toString(),
          unitPrice: saleItem.unitPrice,
          lineTotal: lineTotal.toString(),
          condition,
          restocked,
        },
      });

      if (restocked) {
        await recordStockMovement(tx, {
          businessId,
          productId: saleItem.productId,
          batchId: saleItem.batchId ?? undefined,
          reason: StockMovementReason.SALE_RETURN,
          quantityChange: requested,
          relatedType: 'SaleReturn',
          relatedId: saleReturn.id,
          createdByUserId: userId,
        });
      }
      // Damaged/expired returns are not restocked: the SaleReturnItem row
      // (condition + restocked=false) is itself the audit trail for why
      // this quantity never went back into sellable stock.
    }

    await tx.saleReturn.update({ where: { id: saleReturn.id }, data: { totalAmount: totalAmount.toString() } });

    const newBalance = new Decimal(sale.balance.toString()).minus(totalAmount);
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        balance: newBalance.toString(),
        status: deriveStatusFromBalance(newBalance, sale.amountPaid.toString()),
      },
    });

    // A walk-in sale never created a receivable, so there is nothing to credit
    // back on a ledger. Their refund is handled purely through the cash account
    // below, which is also the only way they could have paid in the first place.
    if (sale.farmerId) {
      await recordLedgerEntry(tx, {
        businessId,
        partyType: PartyType.FARMER,
        farmerId: sale.farmerId,
        direction: LedgerDirection.CREDIT,
        amount: totalAmount,
        relatedType: 'SaleReturn',
        relatedId: saleReturn.id,
        description: `Sale return ${returnNumber} on ${sale.invoiceNumber}`,
      });
    }

    if (input.cashRefundAccountId) {
      const account = await tx.account.findFirst({ where: { id: input.cashRefundAccountId, businessId } });
      if (!account) throw AppError.notFound('Account not found');
      await assertSufficientFunds(tx, input.cashRefundAccountId, totalAmount, 'refund');
      await recordAccountTransaction(tx, {
        businessId,
        accountId: input.cashRefundAccountId,
        direction: LedgerDirection.DEBIT,
        amount: totalAmount,
        relatedType: 'SaleReturn',
        relatedId: saleReturn.id,
        description: `Cash refund for return ${returnNumber}`,
        txnDate: saleReturn.returnDate,
      });
    }

    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'CREATE',
      entityType: 'SaleReturn',
      entityId: saleReturn.id,
      afterData: { returnNumber, totalAmount: totalAmount.toString(), saleId: sale.id },
    });

    return tx.saleReturn.findUniqueOrThrow({ where: { id: saleReturn.id }, include: { items: true } });
  });
}
