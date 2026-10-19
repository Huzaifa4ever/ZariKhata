import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import * as service from './farmerPayments.service';

export const farmerPaymentRouter = Router();
farmerPaymentRouter.use(requireAuth);

farmerPaymentRouter.get('/', async (req, res, next) => {
  try {
    const farmerId = req.query.farmerId ? Number(req.query.farmerId) : undefined;
    res.json(await service.listFarmerPayments(req.businessId!, farmerId));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  farmerId: z.number().int(),
  accountId: z.number().int(),
  amount: z.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  paymentDate: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
  allocations: z.array(z.object({ saleId: z.number().int(), amount: z.number().positive() })).optional(),
});

farmerPaymentRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const payment = await service.recordFarmerPayment(req.businessId!, req.user!.id, data);
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});
