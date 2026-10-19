import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db/prisma';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

describe('inventory', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await getTestContext();
  });

  async function makeProduct(auth: string) {
    const supplier = await request(app)
      .post('/api/suppliers')
      .set('Authorization', auth)
      .send({ name: `Supplier ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'Test Product', unit: 'bottle', sellingPrice: 100 });
    return { supplier: supplier.body, product: product.body };
  }

  it('a purchase increases stock', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { supplier, product } = await makeProduct(auth);

    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({
        supplierId: supplier.id,
        invoiceDate: new Date().toISOString(),
        items: [{ productId: product.id, quantity: 50, unitCost: 10 }],
      });
    expect(purchase.status).toBe(201);

    const fetched = await request(app).get(`/api/products/${product.id}`).set('Authorization', auth);
    expect(Number(fetched.body.currentStock)).toBe(50);
  });

  it('a sale decreases stock', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { supplier, product } = await makeProduct(auth);
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 50, unitCost: 10 }] });

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `Farmer ${uniqueSuffix()}` });
    await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({ farmerId: farmer.body.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 20, unitPrice: 25 }] });

    const fetched = await request(app).get(`/api/products/${product.id}`).set('Authorization', auth);
    expect(Number(fetched.body.currentStock)).toBe(30);
  });

  it('overselling is rejected by default', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { supplier, product } = await makeProduct(auth);
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 5, unitCost: 10 }] });

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `Farmer ${uniqueSuffix()}` });
    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({ farmerId: farmer.body.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 999, unitPrice: 25 }] });

    expect(res.status).toBe(409);
  });

  it('two concurrent sales cannot both sell the same remaining stock', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { supplier, product } = await makeProduct(auth);
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 10, unitCost: 10 }] });

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `Farmer ${uniqueSuffix()}` });

    const sell = () =>
      request(app)
        .post('/api/sales')
        .set('Authorization', auth)
        .send({ farmerId: farmer.body.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 8, unitPrice: 25 }] });

    const [a, b] = await Promise.all([sell(), sell()]);
    const statuses = [a.status, b.status].sort();
    // Exactly one of the two should succeed (10 in stock, each wants 8 — both can't fit).
    expect(statuses).toEqual([201, 409]);

    const fetched = await request(app).get(`/api/products/${product.id}`).set('Authorization', auth);
    expect(Number(fetched.body.currentStock)).toBe(2);
  });

  it('ProductBatch.quantityRemaining always equals the sum of its StockMovement rows (regression: batches must not be pre-seeded with quantity AND incremented by the movement)', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { supplier, product } = await makeProduct(auth);
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 40, unitCost: 10 }] });

    const batchId = purchase.body.items[0].batchId;
    const batch = await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } });
    const movementSum = await prisma.stockMovement.aggregate({ where: { batchId }, _sum: { quantityChange: true } });

    expect(Number(batch.quantityRemaining)).toBe(Number(movementSum._sum.quantityChange));
    expect(Number(batch.quantityRemaining)).toBe(40);
  });

  // The reason used to be mandatory. It is now optional: forcing a free-text
  // box before someone can correct a shelf count only produced "x". A default
  // note is stored instead, so the movement is still explainable.
  it('a stock adjustment works without a reason, and records a default note', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { product } = await makeProduct(auth);

    const res = await request(app)
      .post(`/api/products/${product.id}/adjust-stock`)
      .set('Authorization', auth)
      .send({ quantityChange: 5 });
    expect(res.status).toBe(200);
    expect(Number(res.body.currentStock)).toBe(5);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: product.id, reason: 'ADJUSTMENT' },
    });
    expect(movement.notes).toBeTruthy();

    const zero = await request(app)
      .post(`/api/products/${product.id}/adjust-stock`)
      .set('Authorization', auth)
      .send({ quantityChange: 0 });
    expect(zero.status).toBe(400);
  });

  it('adding stock with an expiry date opens a batch that carries it', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { product } = await makeProduct(auth);

    const res = await request(app)
      .post(`/api/products/${product.id}/adjust-stock`)
      .set('Authorization', auth)
      .send({ quantityChange: 12, expiryDate: '2030-05-31', batchNumber: 'B-TEST' });
    expect(res.status).toBe(200);

    const batch = await prisma.productBatch.findFirstOrThrow({
      where: { productId: product.id, batchNumber: 'B-TEST' },
    });
    expect(batch.expiryDate?.toISOString()).toBe('2030-05-30T19:00:00.000Z'); // Karachi midnight
    expect(Number(batch.quantityRemaining)).toBe(12);
  });

  it('a purchase return decreases stock and a sales return restores only the valid quantity', async () => {
    const auth = `Bearer ${ctx.token}`;
    const { supplier, product } = await makeProduct(auth);
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 20, unitCost: 10 }] });
    const purchaseItemId = purchase.body.items[0].id;

    const purchaseReturn = await request(app)
      .post('/api/purchase-returns')
      .set('Authorization', auth)
      .send({ purchaseId: purchase.body.id, items: [{ purchaseItemId, quantity: 5 }] });
    expect(purchaseReturn.status).toBe(201);

    let fetched = await request(app).get(`/api/products/${product.id}`).set('Authorization', auth);
    expect(Number(fetched.body.currentStock)).toBe(15);

    // Returning more than eligible is rejected.
    const overReturn = await request(app)
      .post('/api/purchase-returns')
      .set('Authorization', auth)
      .send({ purchaseId: purchase.body.id, items: [{ purchaseItemId, quantity: 999 }] });
    expect(overReturn.status).toBe(409);

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `Farmer ${uniqueSuffix()}` });
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', auth)
      .send({ farmerId: farmer.body.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 10, unitPrice: 25 }] });
    const saleItemId = sale.body.items[0].id;

    const saleReturn = await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.body.id, items: [{ saleItemId, quantity: 4, condition: 'SALEABLE' }] });
    expect(saleReturn.status).toBe(201);

    fetched = await request(app).get(`/api/products/${product.id}`).set('Authorization', auth);
    // 15 - 10 sold + 4 returned = 9
    expect(Number(fetched.body.currentStock)).toBe(9);

    const overSaleReturn = await request(app)
      .post('/api/sale-returns')
      .set('Authorization', auth)
      .send({ saleId: sale.body.id, items: [{ saleItemId, quantity: 999 }] });
    expect(overSaleReturn.status).toBe(409);
  });
});
