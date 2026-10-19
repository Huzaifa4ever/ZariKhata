import { Router } from 'express';
import { z } from 'zod';
import { ReturnCondition } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import * as saleReturnsService from './saleReturns.service';

export const saleReturnRouter = Router();
saleReturnRouter.use(requireAuth);

const createSchema = z.object({
  saleId: z.number().int(),
  reason: z.string().optional(),
  cashRefundAccountId: z.number().int().optional(),
  items: z
    .array(
      z.object({
        saleItemId: z.number().int(),
        quantity: z.number().positive(),
        condition: z.nativeEnum(ReturnCondition).optional(),
      }),
    )
    .min(1),
});

saleReturnRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const result = await saleReturnsService.createSaleReturn(req.businessId!, req.user!.id, data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
