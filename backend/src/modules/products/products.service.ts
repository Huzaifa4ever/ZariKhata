import { Prisma, StockMovementReason } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { getProductStock, recordStockMovement } from '../../lib/stock';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { daysFromNow, parseBusinessDate } from '../../lib/dates';

const Decimal = Prisma.Decimal;

export interface ProductFilters {
  q?: string;
  categoryId?: number;
  supplierId?: number;
  activeOnly?: boolean;
  lowStock?: boolean;
  outOfStock?: boolean;
  expiringSoon?: boolean;
  expired?: boolean;
  expiringSoonDays?: number;
}

export async function listProducts(businessId: number, filters: ProductFilters) {
  const products = await prisma.product.findMany({
    where: {
      businessId,
      ...(filters.activeOnly ? { isActive: true } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.supplierId ? { preferredSupplierId: filters.supplierId } : {}),
      ...(filters.q
        ? { OR: [{ name: { contains: filters.q } }, { sku: { contains: filters.q } }] }
        : {}),
    },
    include: { category: true, preferredSupplier: true, createdByUser: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  const now = new Date();
  const soonCutoff = daysFromNow(filters.expiringSoonDays ?? 30);

  const enriched = await Promise.all(
    products.map(async (product) => {
      const stock = await getProductStock(prisma, product.id);
      const batches = await prisma.productBatch.findMany({
        where: { productId: product.id, quantityRemaining: { gt: 0 } },
        orderBy: { expiryDate: 'asc' },
      });
      const expiredBatches = batches.filter((b) => b.expiryDate && b.expiryDate < now);
      const expiringSoonBatches = batches.filter(
        (b) => b.expiryDate && b.expiryDate >= now && b.expiryDate <= soonCutoff,
      );
      return {
        ...product,
        currentStock: stock.toFixed(3),
        isLowStock: stock.lte(new Decimal(product.minStockThreshold.toString())),
        isOutOfStock: stock.lte(0),
        hasExpired: expiredBatches.length > 0,
        hasExpiringSoon: expiringSoonBatches.length > 0,
        expiredBatchCount: expiredBatches.length,
        expiringSoonBatchCount: expiringSoonBatches.length,
      };
    }),
  );

  return enriched.filter((p) => {
    if (filters.lowStock && !p.isLowStock) return false;
    if (filters.outOfStock && !p.isOutOfStock) return false;
    if (filters.expiringSoon && !p.hasExpiringSoon) return false;
    if (filters.expired && !p.hasExpired) return false;
    return true;
  });
}

export async function getProductDetail(businessId: number, id: number) {
  const product = await prisma.product.findFirst({
    where: { id, businessId },
    include: { category: true, preferredSupplier: true, createdByUser: { select: { name: true } } },
  });
  if (!product) throw AppError.notFound('Product not found');
  const stock = await getProductStock(prisma, id);
  const batches = await prisma.productBatch.findMany({
    where: { productId: id },
    orderBy: { createdAt: 'desc' },
  });
  return { ...product, currentStock: stock.toFixed(3), batches };
}

export interface CreateProductInput {
  /** Blank is fine - one is derived from the name. */
  sku?: string;
  name: string;
  categoryId?: number;
  brand?: string;
  unit: string;
  sellingPrice: number;
  minStockThreshold?: number;
  preferredSupplierId?: number;
  notes?: string;
  imageData?: string | null;
  openingStock?: number;
  openingStockCost?: number;
  openingStockExpiryDate?: string;
  openingStockBatchNumber?: string;
}

/**
 * A product code the shop never has to think about.
 *
 * SKU is unique per business because the system needs a stable handle, but
 * that is the system's problem, not the shopkeeper's: a bottle arriving from
 * a supplier mid-invoice does not come with a code, and being made to invent
 * one before the purchase can be saved is pure obstruction. The form said the
 * code was optional and then the server rejected a blank one.
 *
 * Derived from the name, so it still reads as something ("Super Weedkill" ->
 * SUPERW), with a number appended only when that is already taken.
 */
async function deriveSku(businessId: number, name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PRD';
  const taken = await prisma.product.findMany({
    where: { businessId, sku: { startsWith: base } },
    select: { sku: true },
  });
  const used = new Set(taken.map((p) => p.sku));
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // Astronomically unlikely; a timestamp is still unique and still readable.
  return `${base}-${Date.now().toString().slice(-6)}`;
}

export async function createProduct(businessId: number, userId: number, input: CreateProductInput) {
  const sku = input.sku?.trim() || (await deriveSku(businessId, input.name));

  const existing = await prisma.product.findUnique({
    where: { businessId_sku: { businessId, sku } },
  });
  if (existing) {
    throw AppError.conflict(`The code "${sku}" is already used by another product. Pick a different one.`);
  }

  const product = await runInTransaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        businessId,
        sku,
        name: input.name,
        categoryId: input.categoryId,
        brand: input.brand,
        unit: input.unit,
        sellingPrice: input.sellingPrice,
        lastPurchaseCost: input.openingStockCost ?? 0,
        minStockThreshold: input.minStockThreshold ?? 0,
        preferredSupplierId: input.preferredSupplierId,
        notes: input.notes,
        imageData: input.imageData ?? null,
        // Stock is money: every product carries the name of whoever added it.
        createdByUserId: userId,
      },
    });

    if (input.openingStock && input.openingStock > 0) {
      const batch = await tx.productBatch.create({
        data: {
          productId: created.id,
          // Expiry belongs to the batch, not the product — two deliveries of the
          // same item expire on different dates. Opening stock is one batch, so
          // the expiry entered on the add-product form lands here.
          batchNumber: input.openingStockBatchNumber || null,
          expiryDate: input.openingStockExpiryDate ? parseBusinessDate(input.openingStockExpiryDate) : null,
          purchaseCost: input.openingStockCost ?? 0,
          quantityReceived: input.openingStock,
          quantityRemaining: 0, // recordStockMovement below brings this to openingStock
        },
      });
      await recordStockMovement(tx, {
        businessId,
        productId: created.id,
        batchId: batch.id,
        reason: StockMovementReason.OPENING_STOCK,
        quantityChange: input.openingStock,
        relatedType: 'Product',
        relatedId: created.id,
        notes: 'Opening stock at product creation',
        createdByUserId: userId,
      });
    }

    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'CREATE',
      entityType: 'Product',
      entityId: created.id,
      afterData: created,
    });

    return created;
  });

  return getProductDetail(businessId, product.id);
}

export interface UpdateProductInput {
  name?: string;
  categoryId?: number | null;
  brand?: string;
  unit?: string;
  sellingPrice?: number;
  minStockThreshold?: number;
  preferredSupplierId?: number | null;
  notes?: string;
  isActive?: boolean;
}

// Only metadata changes here. A selling-price change here never touches
// past SaleItem rows (they already hold their own unitPrice snapshot), so
// historical invoices are unaffected by future price changes.
export async function updateProduct(
  businessId: number,
  userId: number,
  id: number,
  input: UpdateProductInput,
) {
  const before = await prisma.product.findFirst({ where: { id, businessId } });
  if (!before) throw AppError.notFound('Product not found');
  const updated = await prisma.product.update({ where: { id }, data: input });
  await writeAuditLog(prisma, {
    businessId,
    userId,
    action: 'UPDATE',
    entityType: 'Product',
    entityId: id,
    beforeData: before,
    afterData: updated,
  });
  return getProductDetail(businessId, id);
}

export interface StockAdjustmentInput {
  productId: number;
  batchId?: number;
  quantityChange: number;
  reason?: string;
  expiryDate?: string;
  batchNumber?: string;
}

// A stock adjustment always requires a human-entered reason, stored directly
// on the movement row and duplicated into the audit log.
export async function adjustStock(businessId: number, userId: number, input: StockAdjustmentInput) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, businessId } });
  if (!product) throw AppError.notFound('Product not found');

  return runInTransaction(async (tx) => {
    let batchId = input.batchId;

    // Stock being added with an expiry date needs somewhere to record it, and
    // expiry lives on the batch. Adding to an existing batch would be wrong —
    // that batch has its own expiry — so this opens a new one.
    if (!batchId && input.quantityChange > 0 && (input.expiryDate || input.batchNumber)) {
      const batch = await tx.productBatch.create({
        data: {
          productId: input.productId,
          batchNumber: input.batchNumber || null,
          expiryDate: input.expiryDate ? parseBusinessDate(input.expiryDate) : null,
          purchaseCost: product.lastPurchaseCost,
          quantityReceived: input.quantityChange,
          quantityRemaining: 0, // recordStockMovement below brings this up
        },
      });
      batchId = batch.id;
    }

    await recordStockMovement(tx, {
      businessId,
      productId: input.productId,
      batchId,
      reason: StockMovementReason.ADJUSTMENT,
      quantityChange: input.quantityChange,
      relatedType: 'ManualAdjustment',
      relatedId: input.productId,
      notes: input.reason?.trim() || 'Manual stock adjustment',
      createdByUserId: userId,
    });
    await writeAuditLog(tx, {
      businessId,
      userId,
      action: 'STOCK_ADJUSTMENT',
      entityType: 'Product',
      entityId: input.productId,
      afterData: {
        quantityChange: input.quantityChange,
        reason: input.reason ?? null,
        batchId,
        expiryDate: input.expiryDate ?? null,
      },
    });
    const stock = await getProductStock(tx, input.productId);
    return { productId: input.productId, currentStock: stock.toFixed(3) };
  });
}
