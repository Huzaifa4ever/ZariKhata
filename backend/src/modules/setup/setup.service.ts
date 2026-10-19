import { AccountType, UserRole } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { runInTransaction } from '../../lib/db';
import { ensureInvoiceSequences } from '../../lib/invoiceNumber';
import { hashPassword } from '../../lib/password';
import { AppError } from '../../lib/errors';

// There is no public "sign up" endpoint — this is a one-time action, gated
// by "does a Business row already exist at all". Once the very first setup
// completes, this permanently refuses to run again (see performInitialSetup
// below), so it can never become a standing registration backdoor. This is
// the HTTP-reachable equivalent of prisma/seed.ts's bootstrap(), for the
// desktop app's first-run screen instead of a command line.

export async function isSetupNeeded(): Promise<boolean> {
  const business = await prisma.business.findFirst();
  return !business;
}

export interface InitialSetupInput {
  shopName: string;
  ownerName: string;
  username: string;
  password: string;
}

export async function performInitialSetup(input: InitialSetupInput) {
  const existing = await prisma.business.findFirst();
  if (existing) throw AppError.conflict('This installation is already set up.');

  const existingUsername = await prisma.user.findUnique({ where: { username: input.username } });
  if (existingUsername) throw AppError.conflict('That username is already taken.');

  const passwordHash = await hashPassword(input.password);

  return runInTransaction(async (tx) => {
    const business = await tx.business.create({
      data: { name: input.shopName, currencyCode: 'PKR', currencySymbol: 'Rs' },
    });
    await ensureInvoiceSequences(tx, business.id, {
      salesInvoicePrefix: business.salesInvoicePrefix,
      purchaseInvoicePrefix: business.purchaseInvoicePrefix,
    });
    const owner = await tx.user.create({
      data: {
        businessId: business.id,
        name: input.ownerName,
        username: input.username,
        passwordHash,
        role: UserRole.OWNER,
      },
    });
    await tx.account.create({
      data: { businessId: business.id, name: 'Cash in hand', type: AccountType.CASH, openingBalance: 0 },
    });
    return { business, owner };
  });
}
