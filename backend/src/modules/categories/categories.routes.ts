import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../lib/errors';

export const categoryRouter = Router();
categoryRouter.use(requireAuth);

categoryRouter.get('/', async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { businessId: req.businessId! },
      orderBy: { name: 'asc' },
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ name: z.string().min(1) });

categoryRouter.post('/', async (req, res, next) => {
  try {
    const { name } = createSchema.parse(req.body);
    const existing = await prisma.category.findUnique({
      where: { businessId_name: { businessId: req.businessId!, name } },
    });
    if (existing) throw AppError.conflict('A category with that name already exists');
    const category = await prisma.category.create({ data: { name, businessId: req.businessId! } });
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

categoryRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name } = createSchema.parse(req.body);
    const category = await prisma.category.findFirst({ where: { id, businessId: req.businessId! } });
    if (!category) throw AppError.notFound('Category not found');
    const updated = await prisma.category.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
