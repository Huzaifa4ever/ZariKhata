import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';

export const businessRouter = Router();
businessRouter.use(requireAuth);

businessRouter.get('/', async (req, res, next) => {
  try {
    const business = await prisma.business.findUnique({ where: { id: req.businessId! } });
    if (!business) throw AppError.notFound('Business settings not found');
    res.json(business);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  currencyCode: z.string().min(1).optional(),
  currencySymbol: z.string().min(1).optional(),
  logoPath: z.string().optional(),
  lowStockDefaultAlert: z.number().int().min(0).optional(),
  // Prefixes only affect numbers issued from now on; existing invoices keep
  // the number they were given.
  salesInvoicePrefix: z.string().min(1).max(6).optional(),
  purchaseInvoicePrefix: z.string().min(1).max(6).optional(),
});

businessRouter.patch('/', requireRole('OWNER'), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const before = await prisma.business.findUnique({ where: { id: req.businessId! } });
    const updated = await prisma.business.update({ where: { id: req.businessId! }, data });
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'UPDATE',
      entityType: 'Business',
      entityId: req.businessId!,
      beforeData: before,
      afterData: updated,
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
