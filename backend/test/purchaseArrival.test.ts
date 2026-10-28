import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

/**
 * Ordering goods that arrive later.
 *
 * The rule the whole workflow exists to enforce: money moves when the invoice
 * is raised, stock moves only when the goods are physically in the shop. A
 * pending order must be invisible to stock in every direction - it cannot be
 * sold, it is not in the valuation, and clicking "arrived" twice must not
 * conjure a second delivery.
 */
describe('purchase order arrival', () => {
  let ctx: TestContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
  });

  async function fixtures() {
    const supplier = await request(app)
      .post('/api/suppliers')
      .set('Authorization', auth)
      .send({ name: `Sup ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'Pesticide', unit: 'bottle', sellingPrice: 500 });
    return { supplier: supplier.body, product: product.body };
  }

  async function stockOf(productId: number): Promise<number> {
    const res = await request(app).get(`/api/products/${productId}`).set('Authorization', auth);
    return Number(res.body.currentStock ?? 0);
  }

  async function supplierBalance(id: number): Promise<number> {
    const res = await request(app).get(`/api/suppliers/${id}`).set('Authorization', auth);
    return Number(res.body.outstandingBalance);
  }

  function order(supplierId: number, productId: number, extra: Record<string, unknown> = {}) {
    return request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId,
        isOrder: true,
        invoiceDate: new Date().toISOString(),
        expectedArrivalDate: '2026-12-01',
        items: [{ productId, quantity: 100, unitCost: 200 }],
        ...extra,
      });
  }

  it('an order on credit raises the payable but adds no stock until it arrives', async () => {
    const { supplier, product } = await fixtures();
    const before = await stockOf(product.id);

    const created = await order(supplier.id, product.id);
    expect(created.status).toBe(201);
    expect(created.body.arrivalStatus).toBe('PENDING');
    expect(created.body.expectedArrivalDate).toBeTruthy();

    // Money moved, goods did not.
    expect(await supplierBalance(supplier.id)).toBe(20000);
    expect(await stockOf(product.id)).toBe(before);
  });

  it('a pending order cannot be sold out of - it is not in the shop', async () => {
    const { supplier, product } = await fixtures();
    await order(supplier.id, product.id);
    const farmer = await request(app)
      .post('/api/farmers')
      .set('Authorization', auth)
      .send({ name: `F ${uniqueSuffix()}` });

    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({
        farmerId: farmer.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.id, quantity: 1, unitPrice: 500 }],
      });
    expect(sale.status).toBe(409);
  });

  it('accepts an advance payment before the goods arrive', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id, {
      initialPayment: { accountId: ctx.cashAccountId, amount: 5000, method: 'CASH' },
    });
    expect(created.body.status).toBe('PARTIALLY_PAID');
    expect(Number(created.body.balance)).toBe(15000);
    expect(created.body.arrivalStatus).toBe('PENDING');
    expect(await stockOf(product.id)).toBe(0);
  });

  it('a partial delivery stocks only what arrived and leaves the rest pending', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;

    const received = await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: itemId, quantityAccepted: 40 }] });

    expect(received.status).toBe(200);
    expect(received.body.arrivalStatus).toBe('PARTIAL');
    expect(await stockOf(product.id)).toBe(40);
    // Still owed for the whole order - the rest is still coming.
    expect(await supplierBalance(supplier.id)).toBe(20000);

    const rest = await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: itemId, quantityAccepted: 60 }] });
    expect(rest.body.arrivalStatus).toBe('RECEIVED');
    expect(await stockOf(product.id)).toBe(100);
  });

  it('clicking "arrived" twice with the same key does not stock it twice', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;
    const key = `rcv-${uniqueSuffix()}`;
    const body = { idempotencyKey: key, items: [{ purchaseItemId: itemId, quantityAccepted: 100 }] };

    const first = await request(app).post(`/api/purchases/${created.body.id}/receive`).set('Authorization', auth).send(body);
    const second = await request(app).post(`/api/purchases/${created.body.id}/receive`).set('Authorization', auth).send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await stockOf(product.id)).toBe(100);
    expect(second.body.arrivalStatus).toBe('RECEIVED');
  });

  it('refuses to receive more than was ordered', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;

    const over = await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: itemId, quantityAccepted: 101 }] });
    expect(over.status).toBe(400);
    expect(await stockOf(product.id)).toBe(0);
  });

  it('damaged goods are not stocked and are credited off the invoice', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;

    const received = await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: itemId, quantityAccepted: 90, quantityRejected: 10, notes: 'leaking' }] });

    expect(received.status).toBe(200);
    expect(received.body.arrivalStatus).toBe('RECEIVED');
    expect(await stockOf(product.id)).toBe(90);
    // 10 bottles x Rs 200 came off what we owe.
    expect(Number(received.body.total)).toBe(18000);
    expect(await supplierBalance(supplier.id)).toBe(18000);
  });

  it('closing a short order writes off the rest and drops the payable to match', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;

    const received = await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ closeOrder: true, items: [{ purchaseItemId: itemId, quantityAccepted: 30 }] });

    expect(received.body.arrivalStatus).toBe('RECEIVED');
    expect(await stockOf(product.id)).toBe(30);
    expect(Number(received.body.total)).toBe(6000);
    expect(await supplierBalance(supplier.id)).toBe(6000);
    // Nothing is left outstanding on the line.
    expect(Number(received.body.items[0].quantityCancelled)).toBe(70);
  });

  it('an over-paid short order leaves the supplier owing us, not the other way round', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id, {
      initialPayment: { accountId: ctx.cashAccountId, amount: 20000, method: 'CASH' },
    });
    const itemId = created.body.items[0].id;

    const received = await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ closeOrder: true, items: [{ purchaseItemId: itemId, quantityAccepted: 50 }] });

    expect(Number(received.body.total)).toBe(10000);
    expect(received.body.status).toBe('PAID');
    // Paid 20000 for 10000 of goods: 10000 sits as credit with the supplier.
    expect(await supplierBalance(supplier.id)).toBe(-10000);
  });

  it('a normal counter purchase still stocks immediately, as before', async () => {
    const { supplier, product } = await fixtures();
    const created = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.id, quantity: 25, unitCost: 200 }],
      });
    expect(created.body.arrivalStatus).toBe('RECEIVED');
    expect(await stockOf(product.id)).toBe(25);
  });

  it('deleting a part-arrived order winds back its stock and its credit note', async () => {
    const { supplier, product } = await fixtures();
    const payableBefore = await supplierBalance(supplier.id);
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;

    await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: itemId, quantityAccepted: 30, quantityRejected: 5 }] });
    expect(await stockOf(product.id)).toBe(30);

    const removed = await request(app)
      .delete(`/api/admin/purchases/${created.body.id}`)
      .set('Authorization', auth);
    expect(removed.status).toBe(200);

    // Nothing left behind: not the stock, not the credit for the damaged five.
    expect(await stockOf(product.id)).toBe(0);
    expect(await supplierBalance(supplier.id)).toBe(payableBefore);
  });

  it('refuses to edit an order that is still arriving', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);

    const edit = await request(app)
      .patch(`/api/admin/purchases/${created.body.id}`)
      .set('Authorization', auth)
      .send({ discount: 100 });
    expect(edit.status).toBe(400);
  });

  it('can only return goods that actually arrived', async () => {
    const { supplier, product } = await fixtures();
    const created = await order(supplier.id, product.id);
    const itemId = created.body.items[0].id;
    await request(app)
      .post(`/api/purchases/${created.body.id}/receive`)
      .set('Authorization', auth)
      .send({ items: [{ purchaseItemId: itemId, quantityAccepted: 20 }] });

    const tooMany = await request(app)
      .post('/api/purchase-returns')
      .set('Authorization', auth)
      .send({ purchaseId: created.body.id, items: [{ purchaseItemId: itemId, quantity: 50 }] });
    expect(tooMany.status).toBe(409);

    const ok = await request(app)
      .post('/api/purchase-returns')
      .set('Authorization', auth)
      .send({ purchaseId: created.body.id, items: [{ purchaseItemId: itemId, quantity: 20 }] });
    expect(ok.status).toBe(201);
    expect(await stockOf(product.id)).toBe(0);
  });

  it('dashboard receivables and payables match the party ledgers', async () => {
    const { supplier, product } = await fixtures();
    await order(supplier.id, product.id);

    const dash = await request(app).get('/api/dashboard').set('Authorization', auth);
    expect(dash.status).toBe(200);
    const { finance } = dash.body;

    // Every supplier we owe, summed, is the dashboard payable figure.
    const suppliers = await request(app).get('/api/suppliers').set('Authorization', auth);
    const owed = suppliers.body
      .map((s: { outstandingBalance: string }) => Number(s.outstandingBalance))
      .filter((n: number) => n > 0)
      .reduce((a: number, b: number) => a + b, 0);
    expect(Number(finance.payables.total)).toBeCloseTo(owed, 2);

    const farmers = await request(app).get('/api/farmers').set('Authorization', auth);
    const due = farmers.body
      .map((f: { outstandingBalance: string }) => Number(f.outstandingBalance))
      .filter((n: number) => n > 0)
      .reduce((a: number, b: number) => a + b, 0);
    expect(Number(finance.receivables.total)).toBeCloseTo(due, 2);

    expect(dash.body.pendingArrivalCount).toBeGreaterThan(0);
  });
});

/**
 * The same product bought twice with different expiry dates is the normal
 * case in this trade, not an edge case: three bags going off next month sit
 * on the shelf beside fifty that are good for a year. What matters is which
 * ones leave first.
 */
describe('batches and expiry', () => {
  let ctx: TestContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
  });

  it('sells the near-expiry batch first, not the one bought first', async () => {
    const supplier = await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `S ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'Seed', unit: 'bag', sellingPrice: 500 });

    // Bought first, but expires LAST.
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 50, unitCost: 320, expiryDate: '2030-10-31' }],
      });
    // Bought second, but expires FIRST.
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 3, unitCost: 300, expiryDate: '2027-01-31' }],
      });

    const before = await request(app).get(`/api/products/${product.body.id}`).set('Authorization', auth);
    expect(Number(before.body.currentStock)).toBe(53);
    expect(before.body.batches).toHaveLength(2);

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `F ${uniqueSuffix()}` });
    await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({
        farmerId: farmer.body.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.body.id, quantity: 5, unitPrice: 500 }],
      });

    const after = await request(app).get(`/api/products/${product.body.id}`).set('Authorization', auth);
    expect(Number(after.body.currentStock)).toBe(48);

    const soon = after.body.batches.find((b: any) => String(b.expiryDate).startsWith('2027'));
    const later = after.body.batches.find((b: any) => String(b.expiryDate).startsWith('2030'));
    // All 3 of the near-expiry bags went, then 2 off the long-dated batch.
    expect(Number(soon.quantityRemaining)).toBe(0);
    expect(Number(later.quantityRemaining)).toBe(48);
  });
});
