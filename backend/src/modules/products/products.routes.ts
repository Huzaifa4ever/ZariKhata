import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as productsService from './products.service';

export const productRouter = Router();
productRouter.use(requireAuth);

productRouter.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const filters: productsService.ProductFilters = {
      q: typeof q.q === 'string' ? q.q : undefined,
      categoryId: q.categoryId ? Number(q.categoryId) : undefined,
      supplierId: q.supplierId ? Number(q.supplierId) : undefined,
      activeOnly: q.activeOnly === 'true',
      lowStock: q.lowStock === 'true',
      outOfStock: q.outOfStock === 'true',
      expiringSoon: q.expiringSoon === 'true',
      expired: q.expired === 'true',
      expiringSoonDays: q.expiringSoonDays ? Number(q.expiringSoonDays) : undefined,
    };
    const products = await productsService.listProducts(req.businessId!, filters);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

productRouter.get('/:id', async (req, res, next) => {
  try {
    const product = await productsService.getProductDetail(req.businessId!, Number(req.params.id));
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// ~1.4MB of base64 ≈ a 1MB image. The client resizes well below this; the cap
// is here so a hand-rolled request can't put a 20MB photo in a product row.
const MAX_IMAGE_CHARS = 1_400_000;
const imageDataSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,/, 'Product image must be a PNG, JPEG or WebP data URL')
  .max(MAX_IMAGE_CHARS, 'Product image is too large — use a photo under about 1MB')
  .nullable()
  .optional();

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.number().int().optional(),
  brand: z.string().optional(),
  unit: z.string().min(1),
  sellingPrice: z.number().min(0),
  minStockThreshold: z.number().min(0).optional(),
  preferredSupplierId: z.number().int().optional(),
  notes: z.string().optional(),
  imageData: imageDataSchema,
  openingStock: z.number().min(0).optional(),
  openingStockCost: z.number().min(0).optional(),
  openingStockExpiryDate: z.string().optional(),
  openingStockBatchNumber: z.string().optional(),
});

productRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const product = await productsService.createProduct(req.businessId!, req.user!.id, data);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  categoryId: z.number().int().nullable().optional(),
  brand: z.string().optional(),
  unit: z.string().min(1).optional(),
  sellingPrice: z.number().min(0).optional(),
  minStockThreshold: z.number().min(0).optional(),
  preferredSupplierId: z.number().int().nullable().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
  imageData: imageDataSchema,
});

// Owner-only: correcting an existing record changes history (a price, an
// opening balance, a name on an invoice already printed). Employees create
// records and take payments; only the owner rewrites them.
productRouter.patch('/:id', requireRole('OWNER'), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const product = await productsService.updateProduct(
      req.businessId!,
      req.user!.id,
      Number(req.params.id),
      data,
    );
    res.json(product);
  } catch (err) {
    next(err);
  }
});

const adjustSchema = z.object({
  batchId: z.number().int().optional(),
  quantityChange: z.number().refine((v) => v !== 0, 'quantityChange must not be zero'),
  // Optional: the shopkeeper usually just counted the shelf. A free-text box
  // they have to fill before stock can be corrected only encourages "x".
  reason: z.string().optional(),
  // Stock coming IN can carry an expiry, which creates a batch to hold it.
  expiryDate: z.string().optional(),
  batchNumber: z.string().optional(),
});

productRouter.post('/:id/adjust-stock', async (req, res, next) => {
  try {
    const data = adjustSchema.parse(req.body);
    const result = await productsService.adjustStock(req.businessId!, req.user!.id, {
      productId: Number(req.params.id),
      ...data,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
