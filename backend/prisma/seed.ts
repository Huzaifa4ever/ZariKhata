// Bootstraps the one Business row + OWNER user this deployment needs (idempotent:
// safe to run again, it will not create a second business or duplicate the owner),
// and then, only in non-production with SEED_DEMO_DATA=true, adds clearly-labeled
// demo data so the app can be exercised without typing everything in by hand.
//
// This is the command-line way to bootstrap a business — the desktop app's
// first-run setup screen does the same thing over HTTP instead (see
// src/modules/setup/), gated so it only ever works once: it refuses outright
// the moment a Business row exists. Neither path is an open-ended public
// registration endpoint.
import { PrismaClient, UserRole, AccountType, PaymentMethod, TaskPriority } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { ensureInvoiceSequences } from '../src/lib/invoiceNumber';
import { recordStockMovement } from '../src/lib/stock';
import { recordLedgerEntry } from '../src/lib/ledger';
import { recordAccountTransaction } from '../src/lib/accountLedger';
import { nextInvoiceNumber } from '../src/lib/invoiceNumber';

const prisma = new PrismaClient();

async function bootstrap() {
  let business = await prisma.business.findFirst();
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: process.env.SHOP_NAME ?? 'My Agro Shop',
        currencyCode: 'PKR',
        currencySymbol: 'Rs',
      },
    });
    await prisma.$transaction((tx) =>
      ensureInvoiceSequences(tx, business!.id, {
        salesInvoicePrefix: business!.salesInvoicePrefix,
        purchaseInvoicePrefix: business!.purchaseInvoicePrefix,
      }),
    );
    console.log(`Created business #${business.id}: ${business.name}`);
  } else {
    console.log(`Business already exists: ${business.name} (#${business.id})`);
  }

  const ownerUsername = process.env.OWNER_USERNAME ?? 'owner';
  let owner = await prisma.user.findUnique({ where: { username: ownerUsername } });
  if (!owner) {
    const password = process.env.OWNER_PASSWORD;
    if (!password) {
      throw new Error(
        'OWNER_PASSWORD env var is required to create the first owner account (set it just for this run).',
      );
    }
    owner = await prisma.user.create({
      data: {
        businessId: business.id,
        name: process.env.OWNER_NAME ?? 'Shop Owner',
        username: ownerUsername,
        passwordHash: await hashPassword(password),
        role: UserRole.OWNER,
      },
    });
    console.log(`Created owner user "${owner.username}". Log in with this username and the password you set.`);
  } else {
    console.log(`Owner user "${owner.username}" already exists.`);
  }

  let cashAccount = await prisma.account.findFirst({ where: { businessId: business.id, type: AccountType.CASH } });
  if (!cashAccount) {
    cashAccount = await prisma.account.create({
      data: { businessId: business.id, name: 'Cash in hand', type: AccountType.CASH, openingBalance: 0 },
    });
    console.log('Created default Cash account.');
  }

  const bankAccount = await prisma.account.findFirst({ where: { businessId: business.id, type: AccountType.BANK } });
  if (!bankAccount) {
    await prisma.account.create({
      data: { businessId: business.id, name: 'Bank / Online transfer', type: AccountType.BANK, openingBalance: 0 },
    });
    console.log('Created default Bank/Online account.');
  }

  return { business, owner, cashAccount };
}

async function seedDemoData(businessId: number, ownerId: number, cashAccountId: number) {
  console.log('\nSeeding DEMO data (clearly labeled, dev/testing only)...');

  const category = await prisma.category.upsert({
    where: { businessId_name: { businessId, name: 'Pesticides' } },
    create: { businessId, name: 'Pesticides' },
    update: {},
  });

  const supplierA = await prisma.supplier.create({
    data: { businessId, name: '[DEMO] Agro Chemicals Co.', type: 'Company', phone: '0300-1111111' },
  });
  const supplierB = await prisma.supplier.create({
    data: { businessId, name: '[DEMO] Punjab Seed Traders', type: 'Local supplier', phone: '0300-2222222' },
  });

  const farmerA = await prisma.farmer.create({
    data: { businessId, name: '[DEMO] Ali Hassan', phone: '0333-1111111', village: 'Chak 45' },
  });
  await prisma.farmer.create({
    data: { businessId, name: '[DEMO] Muhammad Tariq', phone: '0333-2222222', village: 'Chak 12' },
  });

  const product = await prisma.product.create({
    data: {
      businessId,
      sku: 'DEMO-PEST-001',
      name: '[DEMO] Super Weedkill 500ml',
      categoryId: category.id,
      unit: 'bottle',
      sellingPrice: 300,
      minStockThreshold: 10,
      preferredSupplierId: supplierA.id,
    },
  });

  // Demo purchase: 100 units @ Rs 200 on supplier credit.
  await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx, businessId, 'PURCHASE');
    const purchase = await tx.purchase.create({
      data: {
        businessId,
        supplierId: supplierA.id,
        invoiceNumber,
        invoiceDate: new Date(),
        subtotal: '20000',
        discount: '0',
        total: '20000',
        amountPaid: '0',
        balance: '20000',
        status: 'UNPAID',
        createdByUserId: ownerId,
        notes: '[DEMO] seed purchase',
      },
    });
    const batch = await tx.productBatch.create({
      data: { productId: product.id, purchaseCost: '200', quantityReceived: '100', quantityRemaining: '0' },
    });
    await tx.purchaseItem.create({
      data: { purchaseId: purchase.id, productId: product.id, batchId: batch.id, quantity: '100', unitCost: '200', lineTotal: '20000' },
    });
    await recordStockMovement(tx, {
      businessId,
      productId: product.id,
      batchId: batch.id,
      reason: 'PURCHASE',
      quantityChange: '100',
      relatedType: 'Purchase',
      relatedId: purchase.id,
      createdByUserId: ownerId,
    });
    await recordLedgerEntry(tx, {
      businessId,
      partyType: 'SUPPLIER',
      supplierId: supplierA.id,
      direction: 'DEBIT',
      amount: '20000',
      relatedType: 'Purchase',
      relatedId: purchase.id,
      description: `Purchase ${invoiceNumber}`,
    });
  });

  // Demo credit sale: 10 units @ Rs 300, farmer pays Rs 1000 up front.
  await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx, businessId, 'SALE');
    const batch = await tx.productBatch.findFirstOrThrow({ where: { productId: product.id } });
    const sale = await tx.sale.create({
      data: {
        businessId,
        farmerId: farmerA.id,
        invoiceNumber,
        invoiceDate: new Date(),
        subtotal: '3000',
        discount: '0',
        total: '3000',
        amountPaid: '1000',
        balance: '2000',
        status: 'PARTIALLY_PAID',
        createdByUserId: ownerId,
        notes: '[DEMO] seed sale',
      },
    });
    await tx.saleItem.create({
      data: {
        saleId: sale.id,
        productId: product.id,
        batchId: batch.id,
        quantity: '10',
        unitPrice: '300',
        unitCost: '200',
        lineTotal: '3000',
      },
    });
    await recordStockMovement(tx, {
      businessId,
      productId: product.id,
      batchId: batch.id,
      reason: 'SALE',
      quantityChange: '-10',
      relatedType: 'Sale',
      relatedId: sale.id,
      createdByUserId: ownerId,
    });
    await recordLedgerEntry(tx, {
      businessId,
      partyType: 'FARMER',
      farmerId: farmerA.id,
      direction: 'DEBIT',
      amount: '3000',
      relatedType: 'Sale',
      relatedId: sale.id,
      description: `Sale ${invoiceNumber}`,
    });

    const payment = await tx.farmerPayment.create({
      data: {
        businessId,
        farmerId: farmerA.id,
        accountId: cashAccountId,
        amount: '1000',
        method: PaymentMethod.CASH,
        createdByUserId: ownerId,
        notes: '[DEMO] initial payment on seed sale',
      },
    });
    await tx.farmerPaymentAllocation.create({
      data: { farmerPaymentId: payment.id, saleId: sale.id, allocatedAmount: '1000' },
    });
    await recordLedgerEntry(tx, {
      businessId,
      partyType: 'FARMER',
      farmerId: farmerA.id,
      direction: 'CREDIT',
      amount: '1000',
      relatedType: 'FarmerPayment',
      relatedId: payment.id,
      description: `Payment on sale ${invoiceNumber}`,
    });
    await recordAccountTransaction(tx, {
      businessId,
      accountId: cashAccountId,
      direction: 'CREDIT',
      amount: '1000',
      relatedType: 'FarmerPayment',
      relatedId: payment.id,
      description: '[DEMO] initial payment',
    });
  });

  // Demo supplier payment of Rs 5000 against the seed purchase.
  await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findFirstOrThrow({ where: { businessId, supplierId: supplierA.id } });
    const payment = await tx.supplierPayment.create({
      data: {
        businessId,
        supplierId: supplierA.id,
        accountId: cashAccountId,
        amount: '5000',
        method: PaymentMethod.CASH,
        createdByUserId: ownerId,
        notes: '[DEMO] seed supplier payment',
      },
    });
    await tx.supplierPaymentAllocation.create({
      data: { supplierPaymentId: payment.id, purchaseId: purchase.id, allocatedAmount: '5000' },
    });
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { amountPaid: '5000', balance: '15000', status: 'PARTIALLY_PAID' },
    });
    await recordLedgerEntry(tx, {
      businessId,
      partyType: 'SUPPLIER',
      supplierId: supplierA.id,
      direction: 'CREDIT',
      amount: '5000',
      relatedType: 'SupplierPayment',
      relatedId: payment.id,
      description: '[DEMO] payment to supplier',
    });
    await recordAccountTransaction(tx, {
      businessId,
      accountId: cashAccountId,
      direction: 'DEBIT',
      amount: '5000',
      relatedType: 'SupplierPayment',
      relatedId: payment.id,
      description: '[DEMO] payment to supplier',
    });
  });

  const expenseCategory = await prisma.expenseCategory.upsert({
    where: { businessId_name: { businessId, name: 'Rent' } },
    create: { businessId, name: 'Rent' },
    update: {},
  });
  await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        businessId,
        categoryId: expenseCategory.id,
        accountId: cashAccountId,
        amount: '2000',
        description: '[DEMO] shop rent',
        createdByUserId: ownerId,
      },
    });
    await recordAccountTransaction(tx, {
      businessId,
      accountId: cashAccountId,
      direction: 'DEBIT',
      amount: '2000',
      relatedType: 'Expense',
      relatedId: expense.id,
      description: '[DEMO] shop rent',
    });
  });

  await prisma.task.create({
    data: {
      businessId,
      title: '[DEMO] Follow up on Ali Hassan\'s remaining balance',
      description: 'Remaining Rs 2000 from the seed sale',
      relatedType: 'Farmer',
      relatedId: farmerA.id,
      priority: TaskPriority.MEDIUM,
    },
  });
  void supplierB;

  console.log('Demo data seeded.');
}

async function main() {
  const { business, owner, cashAccount } = await bootstrap();

  if (process.env.SEED_DEMO_DATA === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to seed demo data with NODE_ENV=production.');
    }
    await seedDemoData(business.id, owner.id, cashAccount.id);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
