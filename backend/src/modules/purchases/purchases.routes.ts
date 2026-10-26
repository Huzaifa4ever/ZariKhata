import { Router } from 'express';
import { z } from 'zod';
import { ArrivalStatus, DocumentStatus, PaymentMethod } from '@prisma/client';
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
      arrivalStatus: q.arrivalStatus as ArrivalStatus | undefined,
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
  isOrder: z.boolean().optional(),
  expectedArrivalDate: z.string().optional(),
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

const receiveSchema = z.object({
  receivedDate: z.string().optional(),
  notes: z.string().optional(),
  closeOrder: z.boolean().optional(),
  idempotencyKey: z.string().max(80).optional(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.number().int(),
        quantityAccepted: z.number().min(0),
        quantityRejected: z.number().min(0).optional(),
        expiryDate: z.string().optional(),
        batchNumber: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});

/** Confirm an order has turned up. The only route that stocks ordered goods. */
purchaseRouter.post('/:id/receive', async (req, res, next) => {
  try {
    const data = receiveSchema.parse(req.body);
    const purchase = await purchasesService.receivePurchase(
      req.businessId!,
      req.user!.id,
      Number(req.params.id),
      data,
    );
    res.json(purchase);
  } catch (err) {
    next(err);
  }
});

purchaseRouter.get('/:id/receipts', async (req, res, next) => {
  try {
    res.json(await purchasesService.listPurchaseReceipts(req.businessId!, Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});
