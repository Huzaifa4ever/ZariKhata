import { Router } from 'express';
import { z } from 'zod';
import { DocumentStatus, PaymentMethod } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import * as purchasesService from './purchases.service';

export const purchaseRouter = Router();
purchaseRouter.use(requireAuth);

purchaseRouter.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const purchases = await purchasesService.listPurchases(req.businessId!, {
      supplierId: q.supplierId ? Number(q.supplierId) : undefined,
      status: q.status as DocumentStatus | undefined,
      from: typeof q.from === 'string' ? q.from : undefined,
      to: typeof q.to === 'string' ? q.to : undefined,
      q: typeof q.q === 'string' ? q.q : undefined,
    });
    res.json(purchases);
  } catch (err) {
    next(err);
  }
});

purchaseRouter.get('/:id', async (req, res, next) => {
  try {
    const purchase = await purchasesService.getPurchaseDetail(req.businessId!, Number(req.params.id));
    res.json(purchase);
  } catch (err) {
    next(err);
  }
});

const itemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitCost: z.number().min(0),
  discount: z.number().min(0).optional(),
  batchNumber: z.string().optional(),
  manufactureDate: z.string().optional(),
  expiryDate: z.string().optional(),
});

const createSchema = z.object({
  supplierId: z.number().int(),
  supplierInvoiceNumber: z.string().optional(),
  invoiceDate: z.string(),
  dueDate: z.string().optional(),
  discount: z.number().min(0).optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
  initialPayment: z
    .object({
      accountId: z.number().int(),
      amount: z.number().positive(),
      method: z.nativeEnum(PaymentMethod),
      notes: z.string().optional(),
    })
    .optional(),
});

purchaseRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const purchase = await purchasesService.createPurchase(req.businessId!, req.user!.id, data);
    res.status(201).json(purchase);
  } catch (err) {
    next(err);
  }
});
