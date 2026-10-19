import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { requireAuth } from '../../middleware/auth';
import * as service from './supplierPayments.service';

export const supplierPaymentRouter = Router();
supplierPaymentRouter.use(requireAuth);

supplierPaymentRouter.get('/', async (req, res, next) => {
  try {
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    res.json(await service.listSupplierPayments(req.businessId!, supplierId));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  supplierId: z.number().int(),
  accountId: z.number().int(),
  amount: z.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  paymentDate: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
  allocations: z.array(z.object({ purchaseId: z.number().int(), amount: z.number().positive() })).optional(),
});

supplierPaymentRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const payment = await service.recordSupplierPayment(req.businessId!, req.user!.id, data);
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});
