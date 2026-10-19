import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import { writeAuditLog } from '../../lib/audit';
import { getFarmerBalance } from '../../lib/ledger';
import { AppError } from '../../lib/errors';

export const farmerRouter = Router();
farmerRouter.use(requireAuth);

farmerRouter.get('/', async (req, res, next) => {
  try {
    const { q, activeOnly } = req.query as { q?: string; activeOnly?: string };
    const farmers = await prisma.farmer.findMany({
      where: {
        businessId: req.businessId!,
        ...(activeOnly === 'true' ? { isActive: true } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { phone: { contains: q } },
                { farmerCode: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
    const withBalances = await Promise.all(
      farmers.map(async (f) => ({ ...f, outstandingBalance: (await getFarmerBalance(prisma, f.id)).toFixed(2) })),
    );
    res.json(withBalances);
  } catch (err) {
    next(err);
  }
});

farmerRouter.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const farmer = await prisma.farmer.findFirst({ where: { id, businessId: req.businessId! } });
    if (!farmer) throw AppError.notFound('Farmer not found');
    const outstandingBalance = (await getFarmerBalance(prisma, id)).toFixed(2);
    res.json({ ...farmer, outstandingBalance });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  farmerCode: z.string().optional(),
  phone: z.string().optional(),
  village: z.string().optional(),
  cropInfo: z.string().optional(),
  notes: z.string().optional(),
  openingBalance: z.number().default(0),
});

farmerRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const farmer = await prisma.farmer.create({ data: { ...data, businessId: req.businessId! } });
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'Farmer',
      entityId: farmer.id,
      afterData: farmer,
      ipAddress: req.ip,
    });
    res.status(201).json(farmer);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

farmerRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const before = await prisma.farmer.findFirst({ where: { id, businessId: req.businessId! } });
    if (!before) throw AppError.notFound('Farmer not found');
    const updated = await prisma.farmer.update({ where: { id }, data });
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'UPDATE',
      entityType: 'Farmer',
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

farmerRouter.get('/:id/ledger', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const farmer = await prisma.farmer.findFirst({ where: { id, businessId: req.businessId! } });
    if (!farmer) throw AppError.notFound('Farmer not found');
    const entries = await prisma.ledgerEntry.findMany({
      where: { businessId: req.businessId!, partyType: 'FARMER', farmerId: id },
      orderBy: { entryDate: 'asc' },
    });
    res.json({ farmer, openingBalance: farmer.openingBalance, entries });
  } catch (err) {
    next(err);
  }
});

/**
 * Everything this farmer has ever bought, grouped by product.
 *
 * Answers the question the owner actually asks at the counter — "what does
 * he usually take?" — which otherwise means opening every invoice one by one.
 * `lastPrice` is what they were charged most recently, so a repeat sale can
 * be priced consistently.
 */
farmerRouter.get('/:id/products', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    const farmer = await prisma.farmer.findFirst({ where: { id, businessId } });
    if (!farmer) throw AppError.notFound('Farmer not found');

    const items = await prisma.saleItem.findMany({
      where: { sale: { businessId, farmerId: id } },
      include: {
        product: true,
        sale: { select: { invoiceDate: true, invoiceNumber: true } },
      },
      orderBy: { id: 'desc' },
    });

    const byProduct = new Map<number, any>();
    for (const item of items) {
      const qty = Number(item.quantity);
      const value = Number(item.lineTotal);
      const existing = byProduct.get(item.productId);
      if (existing) {
        existing.totalQuantity += qty;
        existing.totalValue += value;
        existing.timesBought += 1;
        continue;
      }
      // Newest first, so the first row seen carries the latest price.
      byProduct.set(item.productId, {
        productId: item.productId,
        name: item.product.name,
        sku: item.product.sku,
        unit: item.product.unit,
        lastPrice: item.unitPrice.toString(),
        currentPrice: item.product.sellingPrice.toString(),
        lastBought: item.sale.invoiceDate.toISOString().slice(0, 10),
        lastInvoice: item.sale.invoiceNumber,
        totalQuantity: qty,
        totalValue: value,
        timesBought: 1,
      });
    }

    const rows = [...byProduct.values()]
      .sort((a, b) => b.totalValue - a.totalValue)
      .map((r) => ({ ...r, totalQuantity: r.totalQuantity.toFixed(2), totalValue: r.totalValue.toFixed(2) }));

    res.json({ farmer, count: rows.length, rows });
  } catch (err) {
    next(err);
  }
});
