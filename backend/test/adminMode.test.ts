import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

/**
 * Admin mode is the owner's switch for rewriting history.
 *
 * Two things are being pinned down here. First, the boundary: an employee runs
 * the counter - they create sales, purchases and payments - but they never
 * correct or remove an existing record, and the server is what enforces that,
 * not the hidden buttons. Second, that a correction actually corrects: money
 * lives on the party ledger, the cash account AND the invoice it settled, so
 * editing or deleting a payment has to move all three or the books drift.
 */
describe('admin mode', () => {
  let ctx: TestContext;
  let auth: string;
  let employeeAuth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
    const username = `emp${uniqueSuffix()}`;
    await request(app)
      .post('/api/users')
      .set('Authorization', auth)
      .send({ name: 'Counter Staff', username, password: 'EmpPass123!', role: 'EMPLOYEE' });
    const login = await request(app).post('/api/auth/login').send({ username, password: 'EmpPass123!' });
    employeeAuth = `Bearer ${login.body.token}`;
  });

  async function farmerWithSale() {
    const farmer = await request(app)
      .post('/api/farmers')
      .set('Authorization', auth)
      .send({ name: `F ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'P', unit: 'bottle', sellingPrice: 100 });
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: (await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `S ${uniqueSuffix()}` })).body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 100, unitCost: 50 }],
      });
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({
        farmerId: farmer.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 10, unitPrice: 100 }],
      });
    return { farmer: farmer.body, sale: sale.body };
  }

  const balanceOf = async (id: number) =>
    Number((await request(app).get(`/api/farmers/${id}`).set('Authorization', auth)).body.outstandingBalance);
  const saleOf = async (id: number) => (await request(app).get(`/api/sales/${id}`).set('Authorization', auth)).body;

  it('an employee cannot edit records, only create them', async () => {
    const farmer = await request(app).post('/api/farmers').set('Authorization', employeeAuth).send({ name: `F ${uniqueSuffix()}` });
    expect(farmer.status).toBe(201); // taking on a new customer is their job

    const edits = await Promise.all([
      request(app).patch(`/api/farmers/${farmer.body.id}`).set('Authorization', employeeAuth).send({ name: 'Renamed' }),
      request(app).patch('/api/products/1').set('Authorization', employeeAuth).send({ sellingPrice: 1 }),
      request(app).patch('/api/suppliers/1').set('Authorization', employeeAuth).send({ name: 'Renamed' }),
    ]);
    for (const res of edits) expect(res.status).toBe(403);
  });

  it('an employee cannot reach any admin delete or edit', async () => {
    const blocked = await Promise.all([
      request(app).delete('/api/admin/sales/1').set('Authorization', employeeAuth),
      request(app).delete('/api/admin/farmer-payments/1').set('Authorization', employeeAuth),
      request(app).delete('/api/admin/purchase-receipts/1').set('Authorization', employeeAuth),
      request(app).patch('/api/admin/farmer-payments/1').set('Authorization', employeeAuth).send({ amount: 1 }),
      request(app).patch('/api/admin/purchases/1').set('Authorization', employeeAuth).send({ discount: 1 }),
    ]);
    for (const res of blocked) expect(res.status).toBe(403);
  });

  it('deleting a payment puts the invoice it settled back to unpaid', async () => {
    const { farmer, sale } = await farmerWithSale();
    const payment = await request(app)
      .post('/api/farmer-payments')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, accountId: ctx.cashAccountId, amount: 1000, method: 'CASH' });
    expect(payment.status).toBe(201);
    expect((await saleOf(sale.id)).status).toBe('PAID');
    expect(await balanceOf(farmer.id)).toBe(0);

    const removed = await request(app).delete(`/api/admin/farmer-payments/${payment.body.id}`).set('Authorization', auth);
    expect(removed.status).toBe(200);

    // The whole trail goes: ledger, invoice and all.
    const after = await saleOf(sale.id);
    expect(after.status).toBe('UNPAID');
    expect(Number(after.amountPaid)).toBe(0);
    expect(Number(after.balance)).toBe(1000);
    expect(await balanceOf(farmer.id)).toBe(1000);
  });

  it('editing a payment amount re-settles the invoice at the corrected figure', async () => {
    const { farmer, sale } = await farmerWithSale();
    const payment = await request(app)
      .post('/api/farmer-payments')
      .set('Authorization', auth)
      .send({ farmerId: farmer.id, accountId: ctx.cashAccountId, amount: 1000, method: 'CASH' });

    // Counted the cash again: it was 400, not 1000.
    const edited = await request(app)
      .patch(`/api/admin/farmer-payments/${payment.body.id}`)
      .set('Authorization', auth)
      .send({ amount: 400 });
    expect(edited.status).toBe(200);

    const after = await saleOf(sale.id);
    expect(Number(after.amountPaid)).toBe(400);
    expect(Number(after.balance)).toBe(600);
    expect(after.status).toBe('PARTIALLY_PAID');
    expect(await balanceOf(farmer.id)).toBe(600);
  });

  it('undoing a delivery takes the stock back and re-opens the order', async () => {
    const supplier = await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `S ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'P', unit: 'bottle', sellingPrice: 100 });
    const order = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.body.id,
        isOrder: true,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 50, unitCost: 100 }],
      });

    await request(app)
      .post(`/api/purchases/${order.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: order.body.items[0].id, quantityAccepted: 20, quantityRejected: 5 }] });

    const stockAfterArrival = await request(app).get(`/api/products/${product.body.id}`).set('Authorization', auth);
    expect(Number(stockAfterArrival.body.currentStock)).toBe(20);

    const receipts = await request(app).get(`/api/purchases/${order.body.id}/receipts`).set('Authorization', auth);
    const undone = await request(app).delete(`/api/admin/purchase-receipts/${receipts.body[0].id}`).set('Authorization', auth);
    expect(undone.status).toBe(200);

    const back = await request(app).get(`/api/products/${product.body.id}`).set('Authorization', auth);
    expect(Number(back.body.currentStock)).toBe(0);

    const purchase = await request(app).get(`/api/purchases/${order.body.id}`).set('Authorization', auth);
    expect(purchase.body.arrivalStatus).toBe('PENDING');
    // The credit note for the five damaged ones went with it.
    expect(Number(purchase.body.total)).toBe(5000);
    const supplierNow = await request(app).get(`/api/suppliers/${supplier.body.id}`).set('Authorization', auth);
    expect(Number(supplierNow.body.outstandingBalance)).toBe(5000);
  });

  it('refuses to undo a delivery whose stock has already been sold', async () => {
    const supplier = await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `S ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'P', unit: 'bottle', sellingPrice: 100 });
    const order = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.body.id,
        isOrder: true,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 50, unitCost: 100 }],
      });
    await request(app)
      .post(`/api/purchases/${order.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: order.body.items[0].id, quantityAccepted: 50 }] });

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `F ${uniqueSuffix()}` });
    await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({
        farmerId: farmer.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 50, unitPrice: 150 }],
      });

    const receipts = await request(app).get(`/api/purchases/${order.body.id}/receipts`).set('Authorization', auth);
    const refused = await request(app).delete(`/api/admin/purchase-receipts/${receipts.body[0].id}`).set('Authorization', auth);
    expect(refused.status).toBe(400);
  });
});

/**
 * Returns had a complete, tested backend and no screen at all, so this path
 * was never exercised end to end. The undo matters as much as the return:
 * deleting a sale refuses while returns exist against it, so without a way to
 * remove one, a mis-keyed return trapped the invoice forever.
 */
describe('sale returns', () => {
  let ctx: TestContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
  });

  async function soldSale(qty = 10, price = 100) {
    const supplier = await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `S ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'P', unit: 'bottle', sellingPrice: price });
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 100, unitCost: 50 }],
      });
    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `F ${uniqueSuffix()}` });
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({
        farmerId: farmer.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: qty, unitPrice: price }],
      });
    return { product: product.body, farmer: farmer.body, sale: sale.body };
  }

  const stockOf = async (id: number) =>
    Number((await request(app).get(`/api/products/${id}`).set('Authorization', auth)).body.currentStock);
  const owes = async (id: number) =>
    Number((await request(app).get(`/api/farmers/${id}`).set('Authorization', auth)).body.outstandingBalance);

  it('a good return restocks the shelf and credits the farmer', async () => {
    const { product, farmer, sale } = await soldSale();
    expect(await stockOf(product.id)).toBe(90);
    expect(await owes(farmer.id)).toBe(1000);

    const ret = await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 2, condition: 'SALEABLE' }] });

    expect(ret.status).toBe(201);
    expect(await stockOf(product.id)).toBe(92);
    expect(await owes(farmer.id)).toBe(800);
  });

  it('a damaged return credits the farmer but never goes back on the shelf', async () => {
    const { product, farmer, sale } = await soldSale();
    await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 3, condition: 'DAMAGED' }] });

    expect(await stockOf(product.id)).toBe(90);
    expect(await owes(farmer.id)).toBe(700);
  });

  it('refuses to return more than was sold', async () => {
    const { sale } = await soldSale();
    const over = await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 11 }] });
    expect(over.status).toBe(409);
  });

  it('undoing a return puts the stock, the farmer and the invoice back', async () => {
    const { product, farmer, sale } = await soldSale();
    const ret = await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 4, condition: 'SALEABLE' }] });
    expect(await stockOf(product.id)).toBe(94);
    expect(await owes(farmer.id)).toBe(600);

    const undone = await request(app).delete(`/api/admin/sale-returns/${ret.body.id}`).set('Authorization', auth);
    expect(undone.status).toBe(200);

    expect(await stockOf(product.id)).toBe(90);
    expect(await owes(farmer.id)).toBe(1000);
    const after = await request(app).get(`/api/sales/${sale.id}`).set('Authorization', auth);
    expect(Number(after.body.balance)).toBe(1000);
  });

  it('an employee cannot undo a return', async () => {
    const username = `emp${uniqueSuffix()}`;
    await request(app)
      .post('/api/users')
      .set('Authorization', auth)
      .send({ name: 'Staff', username, password: 'EmpPass123!', role: 'EMPLOYEE' });
    const login = await request(app).post('/api/auth/login').send({ username, password: 'EmpPass123!' });
    const res = await request(app)
      .delete('/api/admin/sale-returns/1')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
  });
});
