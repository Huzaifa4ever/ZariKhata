import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import { writeAuditLog } from '../../lib/audit';
import { getSupplierBalance } from '../../lib/ledger';
import { AppError } from '../../lib/errors';

export const supplierRouter = Router();
supplierRouter.use(requireAuth);

supplierRouter.get('/', async (req, res, next) => {
  try {
    const { q, activeOnly } = req.query as { q?: string; activeOnly?: string };
    const suppliers = await prisma.supplier.findMany({
      where: {
        businessId: req.businessId!,
        ...(activeOnly === 'true' ? { isActive: true } : {}),
        ...(q ? { name: { contains: q } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    const withBalances = await Promise.all(
      suppliers.map(async (s) => ({ ...s, outstandingBalance: (await getSupplierBalance(prisma, s.id)).toFixed(2) })),
    );
    res.json(withBalances);
  } catch (err) {
    next(err);
  }
});

supplierRouter.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const supplier = await prisma.supplier.findFirst({ where: { id, businessId: req.businessId! } });
    if (!supplier) throw AppError.notFound('Supplier not found');
    const outstandingBalance = (await getSupplierBalance(prisma, id)).toFixed(2);
    res.json({ ...supplier, outstandingBalance });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  openingBalance: z.number().default(0),
  notes: z.string().optional(),
});

supplierRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const supplier = await prisma.supplier.create({ data: { ...data, businessId: req.businessId! } });
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'Supplier',
      entityId: supplier.id,
      afterData: supplier,
      ipAddress: req.ip,
    });
    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

supplierRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const before = await prisma.supplier.findFirst({ where: { id, businessId: req.businessId! } });
    if (!before) throw AppError.notFound('Supplier not found');
    const updated = await prisma.supplier.update({ where: { id }, data });
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'UPDATE',
      entityType: 'Supplier',
      entityId: id,
      beforeData: before,
      afterData: updated,
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

supplierRouter.get('/:id/ledger', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const supplier = await prisma.supplier.findFirst({ where: { id, businessId: req.businessId! } });
    if (!supplier) throw AppError.notFound('Supplier not found');
    const entries = await prisma.ledgerEntry.findMany({
      where: { businessId: req.businessId!, partyType: 'SUPPLIER', supplierId: id },
      orderBy: { entryDate: 'asc' },
    });
    res.json({ supplier, openingBalance: supplier.openingBalance, entries });
  } catch (err) {
    next(err);
  }
});

/**
 * What this supplier actually sells you, and the margin on it.
 *
 * Built from purchase history rather than the preferred-supplier field alone,
 * because the question the owner is asking is "what do I order from them, and
 * what did it cost" — which only the invoices know. `lastCost` is the most
 * recent price they charged; `sellingPrice` is what the shop charges, so the
 * two sit side by side with the margin worked out.
 */
supplierRouter.get('/:id/catalogue', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const supplier = await prisma.supplier.findFirst({ where: { id, businessId } });
    if (!supplier) throw AppError.notFound('Supplier not found');

    const items = await prisma.purchaseItem.findMany({
      where: { purchase: { businessId, supplierId: id } },
      include: { product: true, purchase: { select: { invoiceDate: true, invoiceNumber: true } } },
      orderBy: { id: 'desc' },
    });

    const byProduct = new Map<number, any>();
    for (const item of items) {
      const existing = byProduct.get(item.productId);
      const qty = Number(item.quantity);
      if (existing) {
        existing.totalQuantity += qty;
        existing.timesOrdered += 1;
        continue;
      }
      // Items come back newest-first, so the first one seen is the latest price.
      byProduct.set(item.productId, {
        productId: item.productId,
        name: item.product.name,
        sku: item.product.sku,
        unit: item.product.unit,
        lastCost: item.unitCost.toString(),
        sellingPrice: item.product.sellingPrice.toString(),
        lastOrdered: item.purchase.invoiceDate.toISOString().slice(0, 10),
        lastInvoice: item.purchase.invoiceNumber,
        totalQuantity: qty,
        timesOrdered: 1,
      });
    }

    const rows = [...byProduct.values()].map((r) => {
      const cost = Number(r.lastCost);
      const sell = Number(r.sellingPrice);
      const profit = sell - cost;
      return {
        ...r,
        totalQuantity: r.totalQuantity.toFixed(2),
        profit: profit.toFixed(2),
        // Margin on the selling price, which is how a shopkeeper thinks about
        // it ("I keep X out of every 100 I take"), not markup on cost.
        marginPercent: sell > 0 ? ((profit / sell) * 100).toFixed(1) : '0.0',
      };
    });

    res.json({ supplier, count: rows.length, rows });
  } catch (err) {
    next(err);
  }
});
