import { Router } from 'express';
import { z } from 'zod';
import { DocumentStatus, PaymentMethod } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import * as salesService from './sales.service';

export const saleRouter = Router();
saleRouter.use(requireAuth);

saleRouter.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const sales = await salesService.listSales(req.businessId!, {
      farmerId: q.farmerId ? Number(q.farmerId) : undefined,
      status: q.status as DocumentStatus | undefined,
      from: typeof q.from === 'string' ? q.from : undefined,
      to: typeof q.to === 'string' ? q.to : undefined,
      q: typeof q.q === 'string' ? q.q : undefined,
    });
    res.json(sales);
  } catch (err) {
    next(err);
  }
});

saleRouter.get('/:id', async (req, res, next) => {
  try {
    const sale = await salesService.getSaleDetail(req.businessId!, Number(req.params.id));
    res.json(sale);
  } catch (err) {
    next(err);
  }
});

const itemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discount: z.number().min(0).optional(),
});

const createSchema = z.object({
  farmerId: z.number().int(),
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

saleRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const sale = await salesService.createSale(req.businessId!, req.user!.id, data);
    res.status(201).json(sale);
  } catch (err) {
    next(err);
  }
});
