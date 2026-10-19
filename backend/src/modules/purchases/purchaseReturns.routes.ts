import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import * as purchaseReturnsService from './purchaseReturns.service';

export const purchaseReturnRouter = Router();
purchaseReturnRouter.use(requireAuth);

const createSchema = z.object({
  purchaseId: z.number().int(),
  reason: z.string().optional(),
  items: z.array(z.object({ purchaseItemId: z.number().int(), quantity: z.number().positive() })).min(1),
});

purchaseReturnRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const result = await purchaseReturnsService.createPurchaseReturn(req.businessId!, req.user!.id, data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
