import { Router } from 'express';
import { z } from 'zod';
import { LedgerDirection } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import { runInTransaction } from '../../lib/db';
import { recordAccountTransaction } from '../../lib/accountLedger';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { parseBusinessDate, parseBusinessDateEnd } from '../../lib/dates';

export const expenseRouter = Router();
expenseRouter.use(requireAuth);

expenseRouter.get('/categories', async (req, res, next) => {
  try {
    res.json(await prisma.expenseCategory.findMany({ where: { businessId: req.businessId! }, orderBy: { name: 'asc' } }));
  } catch (err) {
    next(err);
  }
});

expenseRouter.post('/categories', async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const existing = await prisma.expenseCategory.findUnique({
      where: { businessId_name: { businessId: req.businessId!, name } },
    });
    if (existing) throw AppError.conflict('That expense category already exists');
    res.status(201).json(await prisma.expenseCategory.create({ data: { name, businessId: req.businessId! } }));
  } catch (err) {
    next(err);
  }
});

expenseRouter.get('/', async (req, res, next) => {
  try {
    const { from, to, categoryId, accountId } = req.query as Record<string, string | undefined>;
    const expenses = await prisma.expense.findMany({
      where: {
        businessId: req.businessId!,
        ...(categoryId ? { categoryId: Number(categoryId) } : {}),
        ...(accountId ? { accountId: Number(accountId) } : {}),
        ...(from || to
          ? { expenseDate: { ...(from ? { gte: parseBusinessDate(from) } : {}), ...(to ? { lte: parseBusinessDateEnd(to) } : {}) } }
          : {}),
      },
      include: { category: true, account: true },
      orderBy: { expenseDate: 'desc' },
    });
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  categoryId: z.number().int(),
  accountId: z.number().int(),
  amount: z.number().positive(),
  expenseDate: z.string().optional(),
  description: z.string().optional(),
});

expenseRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const category = await prisma.expenseCategory.findFirst({ where: { id: data.categoryId, businessId: req.businessId! } });
    if (!category) throw AppError.notFound('Expense category not found');
    const account = await prisma.account.findFirst({ where: { id: data.accountId, businessId: req.businessId! } });
    if (!account) throw AppError.notFound('Account not found');

    const expense = await runInTransaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          businessId: req.businessId!,
          categoryId: data.categoryId,
          accountId: data.accountId,
          amount: data.amount,
          expenseDate: data.expenseDate ? parseBusinessDate(data.expenseDate) : new Date(),
          description: data.description,
          createdByUserId: req.user!.id,
        },
      });
      await recordAccountTransaction(tx, {
        businessId: req.businessId!,
        accountId: data.accountId,
        direction: LedgerDirection.DEBIT,
        amount: data.amount,
        relatedType: 'Expense',
        relatedId: created.id,
        description: data.description ?? category.name,
      });
      await writeAuditLog(tx, {
        businessId: req.businessId!,
        userId: req.user!.id,
        action: 'CREATE',
        entityType: 'Expense',
        entityId: created.id,
        afterData: created,
      });
      return created;
    });

    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});
