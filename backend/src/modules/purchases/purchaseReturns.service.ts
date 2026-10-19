import { LedgerDirection, PartyType, Prisma, SequenceType, StockMovementReason } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { recordStockMovement } from '../../lib/stock';
import { recordLedgerEntry } from '../../lib/ledger';
import { nextInvoiceNumber } from '../../lib/invoiceNumber';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { deriveStatusFromBalance } from '../../lib/invoiceStatus';

const Decimal = Prisma.Decimal;

export interface PurchaseReturnItemInput {
  purchaseItemId: number;
  quantity: number;
}

export interface CreatePurchaseReturnInput {
  purchaseId: number;
  reason?: string;
  items: PurchaseReturnItemInput[];
}

export async function createPurchaseReturn(businessId: number, userId: number, input: CreatePurchaseReturnInput) {
  if (input.items.length === 0) throw AppError.badRequest('A return needs at least one item');

  const purchase = await prisma.purchase.findFirst({
    where: { id: input.purchaseId, businessId },
    include: { items: true },
  });
  if (!purchase) throw AppError.notFound('Purchase not found');
  if (purchase.status === 'VOID') throw AppError.badRequest('Cannot return items on a voided purchase');

  return runInTransaction(async (tx) => {
    const returnNumber = await nextInvoiceNumber(tx, businessId, SequenceType.PURCHASE_RETURN);
    const purchaseReturn = await tx.purchaseReturn.create({
      data: { businessId, purchaseId: purchase.id, returnNumber, reason: input.reason, totalAmount: '0' },
    });

    let totalAmount = new Decimal(0);

    for (const reqItem of input.items) {
      const purchaseItem = purchase.items.find((i) => i.id === reqItem.purchaseItemId);
      if (!purchaseItem) throw AppError.badRequest('Purchase item not found on this invoice');

      const alreadyReturned = await tx.purchaseReturnItem.aggregate({
        where: { purchaseItemId: purchaseItem.id },
        _sum: { quantity: true },
      });
      const previouslyReturned = new Decimal(alreadyReturned._sum.quantity?.toString() ?? 0);
      const eligible = new Decimal(purchaseItem.quantity.toString()).minus(previouslyReturned);
      const requested = new Decimal(reqItem.quantity);
      if (requested.gt(eligible)) {
        throw AppError.conflict('Return quantity exceeds what remains returnable for this item', {
          purchaseItemId: purchaseItem.id,
          eligible: eligible.toFixed(3),
        });
      }

      const lineTotal = requested.times(purchaseItem.unitCost.toString());
      totalAmount = totalAmount.plus(lineTotal);

      await tx.purchaseReturnItem.create({
        data: {
          purchaseReturnId: purchaseReturn.id,
          purchaseItemId: purchaseItem.id,
          productId: purchaseItem.productId,
          quantity: requested.toString(),
          unitCost: purchaseItem.unitCost,
          lineTotal: lineTotal.toString(),
        },
      });

      await recordStockMovement(tx, {
        businessId,
        productId: purchaseItem.productId,
        batchId: purchaseItem.batchId ?? undefined,
        reason: StockMovementReason.PURCHASE_RETURN,
        quantityChange: requested.negated(),
        relatedType: 'PurchaseReturn',
        relatedId: purchaseReturn.id,
        createdByUserId: userId,
        // No allowNegativeStock override: if most of this batch has already
        // been sold on to farmers, there may be less physically left than
        // the purchase history alone would suggest is "eligible" to return,
        // and recordStockMovement's own check catches that case.
      });
    }

    await tx.purchaseReturn.update({ where: { id: purchaseReturn.id }, data: { totalAmount: totalAmount.toString() } });

    const newBalance = new Decimal(purchase.balance.toString()).minus(totalAmount);
    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        balance: newBalance.toString(),
        status: deriveStatusFromBalance(newBalance, purchase.amountPaid.toString()),
      },
    });

    await recordLedgerEntry(tx, {
      businessId,
      partyType: PartyType.SUPPLIER,
      supplierId: purchase.supplierId,
      direction: LedgerDirection.CREDIT,
      amount: totalAmount,
      relatedType: 'PurchaseReturn',
      relatedId: purchaseReturn.id,
      description: `Purchase return ${returnNumber} on ${purchase.invoiceNumber}`,
    });

    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'CREATE',
      entityType: 'PurchaseReturn',
      entityId: purchaseReturn.id,
      afterData: { returnNumber, totalAmount: totalAmount.toString(), purchaseId: purchase.id },
    });

    return tx.purchaseReturn.findUniqueOrThrow({ where: { id: purchaseReturn.id }, include: { items: true } });
  });
}
