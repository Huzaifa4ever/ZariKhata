import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

/**
 * The arithmetic here has been wrong twice, in opposite directions, so it is
 * pinned down. Two things come off a month's pay and they are NOT accounted
 * for the same way:
 *
 *   advance          - a loan. Cash left, nothing was spent, so no expense was
 *                      booked. The wage expense at payday covers it.
 *   personal expense - already booked as a cost the day it happened. The wage
 *                      expense must NOT include it again.
 *
 * Either way the shop ends up one month's salary poorer, in cash and in the
 * books, and those two numbers must agree.
 */
describe('payroll', () => {
  let ctx: TestContext;
  let auth: string;
  let categoryId: number;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
    const cat = await request(app)
      .post('/api/expenses/categories')
      .set('Authorization', auth)
      .send({ name: `Misc ${uniqueSuffix()}` });
    categoryId = cat.body.id;
  });

  async function cashBalance(): Promise<number> {
    const res = await request(app).get('/api/accounts').set('Authorization', auth);
    return Number(res.body.find((a: { id: number }) => a.id === ctx.cashAccountId).balance);
  }

  async function expenseTotal(): Promise<number> {
    const res = await request(app).get('/api/expenses').set('Authorization', auth);
    return res.body.reduce((sum: number, e: { amount: string }) => sum + Number(e.amount), 0);
  }

  async function newEmployee(monthlySalary: number) {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', auth)
      .send({
        name: `Emp ${uniqueSuffix()}`,
        username: `emp${uniqueSuffix()}`,
        password: 'EmpPass123!',
        role: 'EMPLOYEE',
        monthlySalary,
      });
    return res.body;
  }

  it('recovers an advance and a personal expense without over- or under-stating the wage cost', async () => {
    const employee = await newEmployee(10000);
    const cash0 = await cashBalance();
    const exp0 = await expenseTotal();

    // Rs 100 taken from the till against the coming salary: cash only.
    await request(app)
      .post('/api/salaries/advance')
      .set('Authorization', auth)
      .send({ userId: employee.id, amount: 100, accountId: ctx.cashAccountId });
    expect(await cashBalance()).toBeCloseTo(cash0 - 100, 2);
    expect(await expenseTotal()).toBeCloseTo(exp0, 2);

    // Rs 500 of their own spending paid for by the shop: a real expense today.
    await request(app)
      .post('/api/expenses')
      .set('Authorization', auth)
      .send({
        categoryId,
        accountId: ctx.cashAccountId,
        amount: 500,
        forUserId: employee.id,
        deductFromSalary: true,
        description: 'personal',
      });
    expect(await cashBalance()).toBeCloseTo(cash0 - 600, 2);
    expect(await expenseTotal()).toBeCloseTo(exp0 + 500, 2);

    const payroll = await request(app).get('/api/salaries?year=2026&month=3').set('Authorization', auth);
    const row = payroll.body.rows.find((r: { userId: number }) => r.userId === employee.id);
    expect(row.advanceOutstanding).toBe('100.00');
    expect(row.expenseDeduction).toBe('500.00');
    expect(row.netPayable).toBe('9400.00');

    await request(app)
      .post('/api/salaries/pay')
      .set('Authorization', auth)
      .send({ userId: employee.id, periodYear: 2026, periodMonth: 3, amount: 9400, accountId: ctx.cashAccountId });

    // 100 + 500 + 9400 left the till; the books charge the full 10000 wage.
    expect(await cashBalance()).toBeCloseTo(cash0 - 10000, 2);
    expect(await expenseTotal()).toBeCloseTo(exp0 + 10000, 2);
  });

  it('refuses to pay the same month twice', async () => {
    const employee = await newEmployee(5000);
    const pay = () =>
      request(app)
        .post('/api/salaries/pay')
        .set('Authorization', auth)
        .send({ userId: employee.id, periodYear: 2026, periodMonth: 4, amount: 5000, accountId: ctx.cashAccountId });
    expect((await pay()).status).toBe(201);
    expect((await pay()).status).toBe(409);
  });

  it('only puts salaried employees on payroll, never the owner', async () => {
    await newEmployee(7000);
    const payroll = await request(app).get('/api/salaries').set('Authorization', auth);
    expect(payroll.body.rows.length).toBeGreaterThan(0);
    expect(payroll.body.rows.every((r: { role: string }) => r.role === 'EMPLOYEE')).toBe(true);
  });

  it("will not mark an owner's expense as deductible from a salary", async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', auth)
      .send({ categoryId, accountId: ctx.cashAccountId, amount: 50, forUserId: ctx.ownerId, deductFromSalary: true });
    expect(res.status).toBe(400);
  });
});
