import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

describe('supplier accounting', () => {
  let ctx: TestContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
  });

  async function setupSupplierAndProduct() {
    const supplier = await request(app).post('/api/suppliers').set('Authorization', auth).send({ name: `Sup ${uniqueSuffix()}` });
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', auth)
      .send({ sku: `SKU-${uniqueSuffix()}`, name: 'P', unit: 'bottle', sellingPrice: 300 });
    return { supplier: supplier.body, product: product.body };
  }

  it('a credit purchase creates the correct payable', async () => {
    const { supplier, product } = await setupSupplierAndProduct();
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 100, unitCost: 200 }] });

    const supplierState = await request(app).get(`/api/suppliers/${supplier.id}`).set('Authorization', auth);
    expect(Number(supplierState.body.outstandingBalance)).toBe(20000);
  });

  it('a partial payment reduces the payable, and a second payment closes it, with no double counting on retry', async () => {
    const { supplier, product } = await setupSupplierAndProduct();
    await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 100, unitCost: 200 }] });

    const key1 = `sp-${uniqueSuffix()}`;
    await request(app)
      .post('/api/supplier-payments')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, accountId: ctx.cashAccountId, amount: 5000, method: 'CASH', idempotencyKey: key1 });

    let supplierState = await request(app).get(`/api/suppliers/${supplier.id}`).set('Authorization', auth);
    expect(Number(supplierState.body.outstandingBalance)).toBe(15000);

    // Retry with the same key: must not double-deduct.
    await request(app)
      .post('/api/supplier-payments')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, accountId: ctx.cashAccountId, amount: 5000, method: 'CASH', idempotencyKey: key1 });

    supplierState = await request(app).get(`/api/suppliers/${supplier.id}`).set('Authorization', auth);
    expect(Number(supplierState.body.outstandingBalance)).toBe(15000);

    await request(app)
      .post('/api/supplier-payments')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, accountId: ctx.cashAccountId, amount: 15000, method: 'CASH', idempotencyKey: `sp2-${uniqueSuffix()}` });

    supplierState = await request(app).get(`/api/suppliers/${supplier.id}`).set('Authorization', auth);
    expect(Number(supplierState.body.outstandingBalance)).toBe(0);
  });

  it('a purchase return reduces the payable correctly', async () => {
    const { supplier, product } = await setupSupplierAndProduct();
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', auth)
      .send({ supplierId: supplier.id, invoiceDate: new Date().toISOString(), items: [{ productId: product.id, quantity: 100, unitCost: 200 }] });

    await request(app)
      .post('/api/purchase-returns')
      .set('Authorization', auth)
      .send({ purchaseId: purchase.body.id, items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 10 }] });

    const supplierState = await request(app).get(`/api/suppliers/${supplier.id}`).set('Authorization', auth);
    // 20000 owed - 2000 returned = 18000
    expect(Number(supplierState.body.outstandingBalance)).toBe(18000);
  });
});
