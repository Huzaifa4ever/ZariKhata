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
      include: {
        category: true,
        account: true,
        forUser: { select: { id: true, name: true, role: true } },
      },
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
  /// Who the money was spent on. Defaults to whoever is recording it.
  forUserId: z.number().int().optional(),
  /// Employee personal spending, recovered from their salary at month end.
  deductFromSalary: z.boolean().optional(),
});

/**
 * Resolve and vet the person an expense is booked against.
 *
 * Every expense belongs to somebody, so this never returns null - it falls
 * back to whoever is recording it. An employee may only book against
 * themselves; letting one push their own spending onto a colleague would
 * undo the point of attributing it at all.
 */
async function resolveForUser(
  businessId: number,
  actor: { id: number; role: string },
  forUserId: number | undefined,
  deductFromSalary: boolean,
) {
  const targetId = forUserId ?? actor.id;
  if (actor.role !== 'OWNER' && targetId !== actor.id) {
    throw AppError.forbidden('You can only record expenses against your own name.');
  }
  const target = await prisma.user.findFirst({ where: { id: targetId, businessId } });
  if (!target) throw AppError.notFound('That person was not found.');
  if (deductFromSalary && target.role !== 'EMPLOYEE') {
    throw AppError.badRequest('Only an employee\'s expense can be deducted from a salary.');
  }
  return { id: target.id, deductFromSalary };
}

expenseRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const category = await prisma.expenseCategory.findFirst({ where: { id: data.categoryId, businessId: req.businessId! } });
    if (!category) throw AppError.notFound('Expense category not found');
    const account = await prisma.account.findFirst({ where: { id: data.accountId, businessId: req.businessId! } });
    if (!account) throw AppError.notFound('Account not found');
    const forUser = await resolveForUser(
      req.businessId!,
      req.user!,
      data.forUserId,
      data.deductFromSalary ?? false,
    );

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
          forUserId: forUser.id,
          deductFromSalary: forUser.deductFromSalary,
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
