import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

describe('farmer accounting', () => {
  let ctx: TestContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
  });

  async function setupFarmerWithStockedProduct(stock = 100) {
    const supplier = await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `Sup ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'P', unit: 'bottle', sellingPrice: 300 });
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.body.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.body.id, quantity: stock, unitCost: 200 }] });
    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `Farmer ${uniqueSuffix()}` });
    return { product: product.body, farmer: farmer.body };
  }

  it('a credit sale creates the correct receivable, and payments reduce it exactly once each', async () => {
    const { product, farmer } = await setupFarmerWithStockedProduct();

    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 10, unitPrice: 300 }] });
    expect(sale.body.balance).toMatch(/^3000/);

    let farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    expect(Number(farmerState.body.outstandingBalance)).toBe(3000);

    // initial payment via sale creation is a separate case (tested in sales suite); here, a standalone first payment.
    const key1 = `pay-${uniqueSuffix()}`;
    await request(app)
      .post('/api/farmer-payments')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, accountId: ctx.cashAccountId, amount: 1000, method: 'CASH', idempotencyKey: key1 });

    farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    expect(Number(farmerState.body.outstandingBalance)).toBe(2000);

    // Retrying the exact same request (same idempotency key) must not double-count.
    await request(app)
      .post('/api/farmer-payments')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, accountId: ctx.cashAccountId, amount: 1000, method: 'CASH', idempotencyKey: key1 });

    farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    expect(Number(farmerState.body.outstandingBalance)).toBe(2000); // unchanged, not 1000

    const key2 = `pay-${uniqueSuffix()}`;
    await request(app)
      .post('/api/farmer-payments')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, accountId: ctx.cashAccountId, amount: 2000, method: 'CASH', idempotencyKey: key2 });

    farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    expect(Number(farmerState.body.outstandingBalance)).toBe(0);

    const saleState = await request(app).get(`/api/sales/${sale.body.id}`).set('Authorization', auth);
    expect(saleState.body.status).toBe('PAID');
  });

  it('an initial payment at sale creation reduces the receivable correctly', async () => {
    const { product, farmer } = await setupFarmerWithStockedProduct();
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({
        farmerId: farmer.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.id, quantity: 10, unitPrice: 300 }],
        initialPayment: { accountId: ctx.cashAccountId, amount: 500, method: 'CASH' },
      });
    expect(Number(sale.body.balance)).toBe(2500);
    const farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    expect(Number(farmerState.body.outstandingBalance)).toBe(2500);
  });

  it('an overpayment is handled by the documented rule: it becomes a credit balance, not an error', async () => {
    const { product, farmer } = await setupFarmerWithStockedProduct();
    await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 10, unitPrice: 300 }] });

    const res = await request(app)
      .post('/api/farmer-payments')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, accountId: ctx.cashAccountId, amount: 5000, method: 'CASH', idempotencyKey: `over-${uniqueSuffix()}` });
    expect(res.status).toBe(201);

    const farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    // 3000 owed, 5000 paid -> balance goes negative (a credit in the farmer's favor)
    expect(Number(farmerState.body.outstandingBalance)).toBe(-2000);
  });

  it('a sale return reduces the farmer balance correctly', async () => {
    const { product, farmer } = await setupFarmerWithStockedProduct();
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 10, unitPrice: 300 }] });

    await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.body.id, items: [{ saleItemId: sale.body.items[0].id, quantity: 2 }] });

    const farmerState = await request(app).get(`/api/farmers/${farmer.id}`).set('Authorization', auth);
    // 3000 owed - 600 returned = 2400
    expect(Number(farmerState.body.outstandingBalance)).toBe(2400);
  });
});
