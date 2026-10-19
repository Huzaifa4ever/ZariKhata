import { Prisma, StockMovementReason } from '@prisma/client';
import type { Tx } from '../db/prisma';
import { lockProductRow, recordStockMovement } from './stock';
import { AppError } from './errors';
const Decimal = Prisma.Decimal;

export interface BatchConsumption {
  batchId: number;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

export interface FifoResult {
  consumed: BatchConsumption[];
  weightedUnitCost: Prisma.Decimal;
}

/**
 * Consumes `quantity` of a product across its batches, oldest-expiry (then
 * oldest-received) first, recording one StockMovement per batch actually
 * touched. Takes a row lock on the Product first so two concurrent sales
 * against the same product can't both read the same "available" batches and
 * oversell — the second transaction blocks on the lock until the first
 * commits its stock movements.
 */
export async function consumeBatchesFifo(
  tx: Tx,
  params: {
    businessId: number;
    productId: number;
    quantity: Prisma.Decimal | number | string;
    relatedType: string;
    relatedId: number;
    createdByUserId?: number;
  },
): Promise<FifoResult> {
  await lockProductRow(tx, params.productId);

  const requested = new Decimal(params.quantity);
  if (requested.lte(0)) throw AppError.badRequest('Quantity must be greater than zero');

  const batches = await tx.productBatch.findMany({
    where: { productId: params.productId, quantityRemaining: { gt: 0 } },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const totalAvailable = batches.reduce((sum, b) => sum.plus(b.quantityRemaining.toString()), new Decimal(0));
  if (totalAvailable.lt(requested)) {
    throw AppError.conflict('Not enough stock available for this product', {
      productId: params.productId,
      available: totalAvailable.toFixed(3),
      requested: requested.toFixed(3),
    });
  }

  let remaining = requested;
  const consumed: BatchConsumption[] = [];

  for (const batch of batches) {
    if (remaining.lte(0)) break;
    const available = new Decimal(batch.quantityRemaining.toString());
    const take = Decimal.min(available, remaining);
    if (take.lte(0)) continue;

    await recordStockMovement(tx, {
      businessId: params.businessId,
      productId: params.productId,
      batchId: batch.id,
      reason: StockMovementReason.SALE,
      quantityChange: take.negated(),
      relatedType: params.relatedType,
      relatedId: params.relatedId,
      createdByUserId: params.createdByUserId,
    });

    consumed.push({ batchId: batch.id, quantity: take, unitCost: new Decimal(batch.purchaseCost.toString()) });
    remaining = remaining.minus(take);
  }

  const totalCost = consumed.reduce((sum, c) => sum.plus(c.quantity.times(c.unitCost)), new Decimal(0));
  const weightedUnitCost = requested.gt(0) ? totalCost.div(requested) : new Decimal(0);

  return { consumed, weightedUnitCost };
}
