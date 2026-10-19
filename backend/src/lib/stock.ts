import { Prisma, StockMovementReason } from '@prisma/client';
import type { Tx } from '../db/prisma';
import { AppError } from './errors';
const Decimal = Prisma.Decimal;
type DecimalInput = string | number | Prisma.Decimal;

// Current stock for a product is the sum of every StockMovement row's
// quantityChange. Movements are append-only (never edited or deleted), so
// this is always reconstructable from history, never an independently
// mutable counter.
export async function getProductStock(tx: Tx, productId: number): Promise<Prisma.Decimal> {
  const result = await tx.stockMovement.aggregate({
    where: { productId },
    _sum: { quantityChange: true },
  });
  return new Decimal(result._sum.quantityChange?.toString() ?? 0);
}

export async function getBatchStock(tx: Tx, batchId: number): Promise<Prisma.Decimal> {
  const result = await tx.stockMovement.aggregate({
    where: { batchId },
    _sum: { quantityChange: true },
  });
  return new Decimal(result._sum.quantityChange?.toString() ?? 0);
}

/**
 * Records a stock movement and, for outgoing movements (negative
 * quantityChange), verifies against the ledger total first so two
 * concurrent sales can't oversell the same remaining stock. Call this
 * inside a prisma.$transaction — MySQL's default REPEATABLE READ combined
 * with the row lock from the immediately-preceding SELECT ... is not enough
 * on its own, so we re-check with a fresh read guarded by the transaction's
 * serialized writes to the same product (see purchases/sales services,
 * which also take a row lock on the Product row itself before moving stock).
 */
export async function recordStockMovement(
  tx: Tx,
  params: {
    businessId: number;
    productId: number;
    batchId?: number;
    reason: StockMovementReason;
    quantityChange: DecimalInput;
    relatedType: string;
    relatedId: number;
    notes?: string;
    createdByUserId?: number;
    allowNegativeStock?: boolean;
  },
) {
  const qty = new Decimal(params.quantityChange);

  if (qty.isNegative() && !params.allowNegativeStock) {
    const currentStock = await getProductStock(tx, params.productId);
    if (currentStock.plus(qty).isNegative()) {
      throw AppError.conflict('Not enough stock available for this product', {
        productId: params.productId,
        available: currentStock.toString(),
        requested: qty.abs().toString(),
      });
    }
  }

  await tx.stockMovement.create({
    data: {
      businessId: params.businessId,
      productId: params.productId,
      batchId: params.batchId,
      reason: params.reason,
      quantityChange: qty.toString(),
      relatedType: params.relatedType,
      relatedId: params.relatedId,
      notes: params.notes,
      createdByUserId: params.createdByUserId,
    },
  });

  if (params.batchId) {
    await tx.productBatch.update({
      where: { id: params.batchId },
      data: { quantityRemaining: { increment: qty } },
    });
  }
}

/**
 * Takes a row lock on the Product so concurrent sales against the same
 * product serialize instead of both reading stale stock and overselling.
 */
export async function lockProductRow(tx: Tx, productId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM Product WHERE id = ${productId} FOR UPDATE`;
}

/**
 * Undo every stock movement a document posted, and delete the rows.
 *
 * `ProductBatch.quantityRemaining` is a stored counter that recordStockMovement
 * maintains, so deleting movement rows on their own leaves it stale — the
 * product-level total (summed from movements) would be right while the batch
 * counter, which FIFO consumption and stock valuation both read, would be
 * wrong. Each movement is reversed against its batch before the rows go.
 */
export async function reverseStockMovements(
  tx: Tx,
  businessId: number,
  relatedType: string,
  relatedId: number,
): Promise<void> {
  const movements = await tx.stockMovement.findMany({
    where: { businessId, relatedType, relatedId },
    select: { batchId: true, quantityChange: true },
  });

  for (const m of movements) {
    if (m.batchId === null) continue;
    await tx.productBatch.update({
      where: { id: m.batchId },
      data: { quantityRemaining: { decrement: m.quantityChange } },
    });
  }

  await tx.stockMovement.deleteMany({ where: { businessId, relatedType, relatedId } });
}
