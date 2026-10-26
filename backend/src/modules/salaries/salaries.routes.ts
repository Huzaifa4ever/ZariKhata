/**
 * Employee salaries.
 *
 * A salary payment is not a new kind of money movement - it is an expense in
 * the "Salaries" category. So paying one creates an ordinary Expense (which
 * already debits the chosen account and already feeds Profit & Loss and the
 * expense report) and links a SalaryPayment row to it for the payroll view.
 *
 * That is the whole reason there is no separate salary ledger: one row moves
 * the money, so payroll can never be counted twice against profit.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runInTransaction } from '../../lib/db';
import { recordAccountTransaction } from '../../lib/accountLedger';
import { writeAuditLog } from '../../lib/audit';
import { parseBusinessDate, formatBusinessDate } from '../../lib/dates';
import { AppError } from '../../lib/errors';

const Decimal = Prisma.Decimal;
export const salaryRouter = Router();
salaryRouter.use(requireAuth, requireRole('OWNER'));

const SALARY_CATEGORY = 'Salaries';

async function salaryCategoryId(tx: any, businessId: number): Promise<number> {
  const cat = await tx.expenseCategory.upsert({
    where: { businessId_name: { businessId, name: SALARY_CATEGORY } },
    create: { businessId, name: SALARY_CATEGORY },
    update: {},
  });
  return cat.id;
}

/** A one-line account of how the payout was arrived at, for the expense row. */
function describePayment(
  label: string,
  net: number,
  advance: Prisma.Decimal,
  deduction: Prisma.Decimal,
  notes?: string,
): string {
  const parts: string[] = [];
  if (advance.gt(0) || deduction.gt(0)) parts.push(`net ${net} paid`);
  if (advance.gt(0)) parts.push(`less ${advance.toFixed(2)} advance`);
  if (deduction.gt(0)) parts.push(`less ${deduction.toFixed(2)} own expenses`);
  if (notes) parts.push(notes);
  if (parts.length === 0) return label;
  return `${label} (${parts.join(', ')})`;
}

/**
 * Payroll for one month: every employee, what they are owed, and whether it
 * has been paid. Defaults to the current business month.
 */
salaryRouter.get('/', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const today = formatBusinessDate(new Date());
    const year = req.query.year ? Number(req.query.year) : Number(today.slice(0, 4));
    const month = req.query.month ? Number(req.query.month) : Number(today.slice(5, 7));

    const [users, payments, allPayments, advances, deductibleExpenses] = await Promise.all([
      // Only people actually on a salary. The owner draws from profit, not
      // payroll, so they do not belong on this list.
      prisma.user.findMany({
        where: { businessId, isActive: true, role: 'EMPLOYEE', monthlySalary: { not: null } },
        select: { id: true, name: true, username: true, role: true, monthlySalary: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
      prisma.salaryPayment.findMany({
        where: { businessId, periodYear: year, periodMonth: month },
        include: { expense: { include: { account: true } } },
      }),
      prisma.salaryPayment.findMany({ where: { businessId }, select: { userId: true, periodYear: true, periodMonth: true } }),
      prisma.employeeAdvance.findMany({ where: { businessId, settledBySalaryPaymentId: null } }),
      // Personal spending booked against an employee and not yet recovered.
      prisma.expense.findMany({
        where: { businessId, deductFromSalary: true, settledBySalaryPaymentId: null },
        include: { category: true },
        orderBy: { expenseDate: 'asc' },
      }),
    ]);

    const byUser = new Map(payments.map((p) => [p.userId, p]));
    const paidPeriods = new Set(allPayments.map((p) => `${p.userId}:${p.periodYear}:${p.periodMonth}`));
    const advanceByUser = new Map<number, Prisma.Decimal>();
    for (const a of advances) {
      advanceByUser.set(a.userId, (advanceByUser.get(a.userId) ?? new Decimal(0)).plus(a.amount.toString()));
    }

    type Deduction = { date: string; label: string; amount: string };
    const deductionsByUser = new Map<number, Deduction[]>();
    const deductionTotalByUser = new Map<number, Prisma.Decimal>();
    for (const e of deductibleExpenses) {
      if (e.forUserId === null) continue;
      const list = deductionsByUser.get(e.forUserId) ?? [];
      list.push({
        date: formatBusinessDate(e.expenseDate),
        label: e.description || e.category.name,
        amount: e.amount.toString(),
      });
      deductionsByUser.set(e.forUserId, list);
      deductionTotalByUser.set(
        e.forUserId,
        (deductionTotalByUser.get(e.forUserId) ?? new Decimal(0)).plus(e.amount.toString()),
      );
    }

    /**
     * Months before the selected one, this year, still unpaid. Counted from
     * the month they joined - someone hired in September does not owe back pay
     * for January.
     */
    function arrearsFor(userId: number, joined: Date): string[] {
      const joinedYear = Number(formatBusinessDate(joined).slice(0, 4));
      const from = joinedYear > year ? month : joinedYear === year ? Number(formatBusinessDate(joined).slice(5, 7)) : 1;
      const out: string[] = [];
      for (let m = from; m < month; m += 1) {
        if (!paidPeriods.has(`${userId}:${year}:${m}`)) out.push(`${String(m).padStart(2, '0')}/${year}`);
      }
      return out;
    }

    const rows = users.map((u) => {
      const paid = byUser.get(u.id);
      const due = new Decimal(u.monthlySalary?.toString() ?? 0);
      const advance = advanceByUser.get(u.id) ?? new Decimal(0);
      const deduction = deductionTotalByUser.get(u.id) ?? new Decimal(0);
      // Anything already handed over - cash advanced, or personal spending the
      // shop paid for - comes off this month's pay.
      const net = Decimal.max(new Decimal(0), due.minus(advance).minus(deduction));
      const missed = arrearsFor(u.id, u.createdAt);
      return {
        userId: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        monthlySalary: u.monthlySalary?.toString() ?? '',
        status: paid ? 'PAID' : 'UNPAID',
        paidAmount: paid ? paid.amount.toString() : '0.00',
        paidDate: paid ? paid.paidDate.toISOString().slice(0, 10) : '',
        account: paid?.expense?.account?.name ?? '',
        outstanding: paid ? '0.00' : due.toFixed(2),
        advanceOutstanding: advance.toFixed(2),
        expenseDeduction: deduction.toFixed(2),
        deductions: deductionsByUser.get(u.id) ?? [],
        netPayable: paid ? '0.00' : net.toFixed(2),
        arrears: missed,
        salaryPaymentId: paid?.id ?? null,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        payroll: acc.payroll.plus(r.monthlySalary || 0),
        paid: acc.paid.plus(r.paidAmount),
        outstanding: acc.outstanding.plus(r.outstanding),
      }),
      { payroll: new Decimal(0), paid: new Decimal(0), outstanding: new Decimal(0) },
    );

    res.json({
      year,
      month,
      rows,
      totals: {
        payroll: totals.payroll.toFixed(2),
        paid: totals.paid.toFixed(2),
        outstanding: totals.outstanding.toFixed(2),
        advances: [...advanceByUser.values()].reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(2),
        deductions: [...deductionTotalByUser.values()].reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(2),
        unpaidCount: rows.filter((r) => r.status === 'UNPAID').length,
        arrearsCount: rows.reduce((n, r) => n + r.arrears.length, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

const paySchema = z.object({
  userId: z.number().int(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  amount: z.number().positive(),
  accountId: z.number().int(),
  paidDate: z.string().optional(),
  notes: z.string().optional(),
});

salaryRouter.post('/pay', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const data = paySchema.parse(req.body);

    const result = await runInTransaction(async (tx) => {
      const employee = await tx.user.findFirst({ where: { id: data.userId, businessId } });
      if (!employee) throw AppError.notFound('Employee not found');

      const already = await tx.salaryPayment.findFirst({
        where: { userId: data.userId, periodYear: data.periodYear, periodMonth: data.periodMonth },
      });
      if (already) {
        throw AppError.conflict(
          `${employee.name} has already been paid for ${data.periodMonth}/${data.periodYear}.`,
        );
      }

      const account = await tx.account.findFirst({ where: { id: data.accountId, businessId } });
      if (!account) throw AppError.notFound('Account not found');

      const paidDate = data.paidDate ? parseBusinessDate(data.paidDate) : new Date();
      const categoryId = await salaryCategoryId(tx, businessId);
      const label = `Salary ${String(data.periodMonth).padStart(2, '0')}/${data.periodYear} - ${employee.name}`;

      // `amount` is the cash handed over now. Anything already advanced left
      // the account earlier as a loan, so it has never been booked as a cost.
      // The wage expense is the full gross; only the net moves cash today.
      const outstandingAdvances = await tx.employeeAdvance.findMany({
        where: { businessId, userId: data.userId, settledBySalaryPaymentId: null },
      });
      const advanceTotal = outstandingAdvances.reduce(
        (sum, a) => sum.plus(a.amount.toString()),
        new Decimal(0),
      );
      const grossWage = new Decimal(data.amount).plus(advanceTotal);

      // Personal spending the shop already paid for. Unlike an advance it was
      // booked as an expense the day it happened, so it must NOT be added to
      // the wage expense here - that would count the same rupees twice. It is
      // only subtracted from the cash handed over, which the caller has
      // already done when it sent the net amount.
      const deductibleExpenses = await tx.expense.findMany({
        where: { businessId, forUserId: data.userId, deductFromSalary: true, settledBySalaryPaymentId: null },
      });
      const deductionTotal = deductibleExpenses.reduce(
        (sum, e) => sum.plus(e.amount.toString()),
        new Decimal(0),
      );

      const expense = await tx.expense.create({
        data: {
          businessId,
          categoryId,
          accountId: data.accountId,
          amount: grossWage.toFixed(2),
          expenseDate: paidDate,
          description: describePayment(label, data.amount, advanceTotal, deductionTotal, data.notes),
          createdByUserId: req.user!.id,
          // The wage is spent on the employee, so it reads as theirs on the
          // Expenses page like every other cost booked against a person.
          forUserId: data.userId,
        },
      });

      // Only the net leaves the account now - the advance already did.
      await recordAccountTransaction(tx, {
        businessId,
        accountId: data.accountId,
        direction: 'DEBIT',
        amount: data.amount.toString(),
        relatedType: 'Expense',
        relatedId: expense.id,
        description: label,
        txnDate: paidDate,
      });

      const payment = await tx.salaryPayment.create({
        data: {
          businessId,
          userId: data.userId,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          amount: data.amount,
          paidDate,
          expenseId: expense.id,
          notes: data.notes,
          createdByUserId: req.user!.id,
        },
      });

      // Recover anything already advanced against this salary.
      await tx.employeeAdvance.updateMany({
        where: { businessId, userId: data.userId, settledBySalaryPaymentId: null },
        data: { settledBySalaryPaymentId: payment.id },
      });
      // Same for personal expenses the shop covered for them this month.
      await tx.expense.updateMany({
        where: { businessId, forUserId: data.userId, deductFromSalary: true, settledBySalaryPaymentId: null },
        data: { settledBySalaryPaymentId: payment.id },
      });

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'CREATE',
        entityType: 'SalaryPayment',
        entityId: payment.id,
        afterData: { employee: employee.name, amount: data.amount, period: label },
      });

      return { payment, employee, account, label };
    });

    res.status(201).json({
      id: result.payment.id,
      employee: result.employee.name,
      amount: result.payment.amount.toString(),
      paidDate: result.payment.paidDate.toISOString().slice(0, 10),
      account: result.account.name,
      period: result.label,
    });
  } catch (err) {
    next(err);
  }
});

/** Undo a salary payment - removes the expense with it, so nothing is stranded. */
salaryRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const payment = await tx.salaryPayment.findFirst({ where: { id, businessId } });
      if (!payment) throw AppError.notFound('Salary payment not found');

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'DELETE',
        entityType: 'SalaryPayment',
        entityId: id,
        beforeData: payment as any,
      });

      // Put any advances this payment settled back to outstanding.
      await tx.employeeAdvance.updateMany({
        where: { settledBySalaryPaymentId: id },
        data: { settledBySalaryPaymentId: null },
      });
      await tx.expense.updateMany({
        where: { settledBySalaryPaymentId: id },
        data: { settledBySalaryPaymentId: null },
      });
      await tx.salaryPayment.delete({ where: { id } });
      // Deleting the expense reverses the money too.
      await tx.accountTransaction.deleteMany({
        where: { businessId, relatedType: 'Expense', relatedId: payment.expenseId },
      });
      await tx.expense.delete({ where: { id: payment.expenseId } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/** Payment history for one employee, for the printable salary report. */
salaryRouter.get('/history/:userId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const businessId = req.businessId!;
    const employee = await prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { id: true, name: true, username: true, role: true, monthlySalary: true },
    });
    if (!employee) throw AppError.notFound('Employee not found');

    const payments = await prisma.salaryPayment.findMany({
      where: { businessId, userId },
      include: { expense: { include: { account: true } } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });

    const total = payments.reduce((sum, p) => sum.plus(p.amount.toString()), new Decimal(0));

    res.json({
      employee: { ...employee, monthlySalary: employee.monthlySalary?.toString() ?? '' },
      totalPaid: total.toFixed(2),
      rows: payments.map((p) => ({
        period: `${String(p.periodMonth).padStart(2, '0')}/${p.periodYear}`,
        paidDate: p.paidDate.toISOString().slice(0, 10),
        amount: p.amount.toString(),
        account: p.expense?.account?.name ?? '-',
        notes: p.notes ?? '',
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* ───────────────────────── employee advances ───────────────────────── */

const advanceSchema = z.object({
  userId: z.number().int(),
  amount: z.number().positive(),
  accountId: z.number().int(),
  takenDate: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Cash handed to an employee against their coming salary.
 *
 * This is NOT an expense - the business has not spent the money, it has lent
 * it and will recover it by paying that much less salary. Booking it as an
 * expense here and again as salary later would double-count it. So it only
 * moves the account balance, and clears when the salary is paid.
 */
salaryRouter.post('/advance', async (req, res, next) => {
  try {
    const businessId = req.businessId!;
    const data = advanceSchema.parse(req.body);

    const advance = await runInTransaction(async (tx) => {
      const employee = await tx.user.findFirst({ where: { id: data.userId, businessId } });
      if (!employee) throw AppError.notFound('Employee not found');
      const account = await tx.account.findFirst({ where: { id: data.accountId, businessId } });
      if (!account) throw AppError.notFound('Account not found');

      const takenDate = data.takenDate ? parseBusinessDate(data.takenDate) : new Date();
      const created = await tx.employeeAdvance.create({
        data: {
          businessId,
          userId: data.userId,
          accountId: data.accountId,
          amount: data.amount,
          takenDate,
          notes: data.notes,
          createdByUserId: req.user!.id,
        },
      });

      await recordAccountTransaction(tx, {
        businessId,
        accountId: data.accountId,
        direction: 'DEBIT',
        amount: data.amount.toString(),
        relatedType: 'EmployeeAdvance',
        relatedId: created.id,
        description: `Advance to ${employee.name}`,
        txnDate: takenDate,
      });

      await writeAuditLog(tx, {
        businessId,
        userId: req.user!.id,
        action: 'CREATE',
        entityType: 'EmployeeAdvance',
        entityId: created.id,
        afterData: { employee: employee.name, amount: data.amount },
      });
      return created;
    });

    res.status(201).json({ id: advance.id, amount: advance.amount.toString() });
  } catch (err) {
    next(err);
  }
});

salaryRouter.get('/advances/:userId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const rows = await prisma.employeeAdvance.findMany({
      where: { businessId: req.businessId!, userId },
      include: { account: true },
      orderBy: { takenDate: 'desc' },
    });
    const outstanding = rows
      .filter((r) => !r.settledBySalaryPaymentId)
      .reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0));
    res.json({
      outstanding: outstanding.toFixed(2),
      rows: rows.map((r) => ({
        id: r.id,
        date: r.takenDate.toISOString().slice(0, 10),
        amount: r.amount.toString(),
        account: r.account?.name ?? '-',
        notes: r.notes ?? '',
        settled: Boolean(r.settledBySalaryPaymentId),
      })),
    });
  } catch (err) {
    next(err);
  }
});

salaryRouter.delete('/advance/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const businessId = req.businessId!;
    await runInTransaction(async (tx) => {
      const adv = await tx.employeeAdvance.findFirst({ where: { id, businessId } });
      if (!adv) throw AppError.notFound('Advance not found');
      if (adv.settledBySalaryPaymentId) {
        throw AppError.badRequest('This advance was already recovered from a salary. Delete that salary payment first.');
      }
      await tx.accountTransaction.deleteMany({
        where: { businessId, relatedType: 'EmployeeAdvance', relatedId: id },
      });
      await tx.employeeAdvance.delete({ where: { id } });
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
