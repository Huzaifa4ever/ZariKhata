import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';
import { UserRole, AccountType } from '@prisma/client';
import { ensureInvoiceSequences } from '../src/lib/invoiceNumber';

export const app = createApp();

const TEST_OWNER_USERNAME = 'test-owner';
const TEST_OWNER_PASSWORD = 'Test1234!';

export interface TestContext {
  businessId: number;
  ownerId: number;
  token: string;
  cashAccountId: number;
}

let cached: TestContext | null = null;

/** Idempotent: safe to call at the top of every test file without creating duplicate fixtures. */
export async function getTestContext(): Promise<TestContext> {
  if (cached) return cached;

  let business = await prisma.business.findFirst({ where: { name: 'Test Business' } });
  if (!business) {
    business = await prisma.business.create({ data: { name: 'Test Business' } });
    await prisma.$transaction((tx) =>
      ensureInvoiceSequences(tx, business!.id, {
        salesInvoicePrefix: business!.salesInvoicePrefix,
        purchaseInvoicePrefix: business!.purchaseInvoicePrefix,
      }),
    );
  }

  let owner = await prisma.user.findUnique({ where: { username: TEST_OWNER_USERNAME } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        businessId: business.id,
        name: 'Test Owner',
        username: TEST_OWNER_USERNAME,
        passwordHash: await hashPassword(TEST_OWNER_PASSWORD),
        role: UserRole.OWNER,
      },
    });
  }

  let cashAccount = await prisma.account.findFirst({ where: { businessId: business.id, type: AccountType.CASH } });
  if (!cashAccount) {
    cashAccount = await prisma.account.create({
      data: { businessId: business.id, name: 'Test Cash', type: AccountType.CASH, openingBalance: 0 },
    });
  }

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: TEST_OWNER_USERNAME, password: TEST_OWNER_PASSWORD });

  cached = { businessId: business.id, ownerId: owner.id, token: loginRes.body.token, cashAccountId: cashAccount.id };
  return cached;
}

/** Unique-enough suffix so fixtures created by different test runs/files don't collide. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}
