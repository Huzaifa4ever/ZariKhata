import { Router } from 'express';
import { z } from 'zod';
import { AccountType, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { getAccountBalance } from '../../lib/accountLedger';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { parseBusinessDate, parseBusinessDateEnd } from '../../lib/dates';

const Decimal = Prisma.Decimal;

export const accountRouter = Router();
accountRouter.use(requireAuth);

accountRouter.get('/', async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({ where: { businessId: req.businessId! }, orderBy: { name: 'asc' } });
    const withBalances = await Promise.all(
      accounts.map(async (a) => ({ ...a, balance: (await getAccountBalance(prisma, a.id)).toFixed(2) })),
    );
    res.json(withBalances);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(AccountType),
  openingBalance: z.number().default(0),
});

accountRouter.post('/', requireRole('OWNER'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const account = await prisma.account.create({ data: { ...data, businessId: req.businessId! } });
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'Account',
      entityId: account.id,
      afterData: account,
      ipAddress: req.ip,
    });
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

accountRouter.get('/:id/statement', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { from, to } = req.query as Record<string, string | undefined>;
    const account = await prisma.account.findFirst({ where: { id, businessId: req.businessId! } });
    if (!account) throw AppError.notFound('Account not found');

    let openingForRange = new Decimal(account.openingBalance.toString());
    if (from) {
      const priorCredit = await prisma.accountTransaction.aggregate({
        where: { accountId: id, direction: 'CREDIT', txnDate: { lt: parseBusinessDate(from) } },
        _sum: { amount: true },
      });
      const priorDebit = await prisma.accountTransaction.aggregate({
        where: { accountId: id, direction: 'DEBIT', txnDate: { lt: parseBusinessDate(from) } },
        _sum: { amount: true },
      });
      openingForRange = openingForRange
        .plus(new Decimal(priorCredit._sum.amount?.toString() ?? 0))
        .minus(new Decimal(priorDebit._sum.amount?.toString() ?? 0));
    }

    const transactions = await prisma.accountTransaction.findMany({
      where: {
        accountId: id,
        ...(from || to ? { txnDate: { ...(from ? { gte: parseBusinessDate(from) } : {}), ...(to ? { lte: parseBusinessDateEnd(to) } : {}) } } : {}),
      },
      orderBy: { txnDate: 'asc' },
    });

    let running = openingForRange;
    const withRunningBalance = transactions.map((t) => {
      running = t.direction === 'CREDIT' ? running.plus(t.amount.toString()) : running.minus(t.amount.toString());
      return { ...t, runningBalance: running.toFixed(2) };
    });

    res.json({ account: { ...account, balance: running.toFixed(2) }, transactions: withRunningBalance });
  } catch (err) {
    next(err);
  }
});

/**
 * Put the recorded balance back in step with the drawer.
 *
 * A shop that starts keeping books mid-stream has a cash balance that is
 * simply wrong: the takings from before the system existed were never
 * entered, so the account reads zero while the drawer holds real money. There
 * was no way to say so, which made every cash payment look like it was
 * overdrawing an empty account.
 *
 * This is a plain entry in the cash book like any other - it is not a silent
 * edit of the balance, and it carries a reason, so the correction is as
 * visible a year later as the thing it corrected.
 */
const adjustSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: z.number().positive(),
  reason: z.string().min(1, 'Say what this adjustment is for.'),
  date: z.string().optional(),
});

accountRouter.post('/:id/adjust', requireRole('OWNER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = adjustSchema.parse(req.body);
    const account = await prisma.account.findFirst({ where: { id, businessId: req.businessId! } });
    if (!account) throw AppError.notFound('Account not found');

    const txn = await prisma.accountTransaction.create({
      data: {
        businessId: req.businessId!,
        accountId: id,
        direction: data.direction === 'IN' ? 'CREDIT' : 'DEBIT',
        amount: new Decimal(data.amount).toString(),
        relatedType: 'Adjustment',
        // No document behind an adjustment - the audit log is the record.
        relatedId: 0,
        description: data.reason.trim(),
        txnDate: data.date ? parseBusinessDate(data.date) : new Date(),
      },
    });

    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'ADJUST',
      entityType: 'Account',
      entityId: id,
      afterData: { direction: data.direction, amount: data.amount, reason: data.reason },
      ipAddress: req.ip,
    });

    res.status(201).json(txn);
  } catch (err) {
    next(err);
  }
});
