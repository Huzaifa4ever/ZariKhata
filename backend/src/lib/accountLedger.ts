import { Prisma, LedgerDirection } from '@prisma/client';
import type { Tx } from '../db/prisma';
import { AppError } from './errors';
const Decimal = Prisma.Decimal;
type DecimalInput = string | number | Prisma.Decimal;

// Account (cash/bank) balance = openingBalance + sum(CREDIT) - sum(DEBIT).
// CREDIT = money coming in (farmer payment received, opening balance);
// DEBIT = money going out (supplier payment, expense).
export async function recordAccountTransaction(
  tx: Tx,
  params: {
    businessId: number;
    accountId: number;
    direction: LedgerDirection;
    amount: DecimalInput;
    relatedType: string;
    relatedId: number;
    description?: string;
    txnDate?: Date;
  },
) {
  await tx.accountTransaction.create({
    data: {
      businessId: params.businessId,
      accountId: params.accountId,
      direction: params.direction,
      amount: params.amount.toString(),
      relatedType: params.relatedType,
      relatedId: params.relatedId,
      description: params.description,
      txnDate: params.txnDate ?? new Date(),
    },
  });
}

/**
 * Refuse to pay out more than the account actually holds.
 *
 * A cash drawer cannot go negative in the real world - if the books say it
 * did, something was recorded wrong, and the longer that sits the harder it is
 * to find. Until now getAccountBalance was only ever read for display, so the
 * shop could quietly run to minus four thousand rupees with no warning
 * anywhere.
 *
 * Blocked for cash, allowed for bank: a bank account legitimately goes
 * overdrawn, and a cheque written against a pending deposit is ordinary
 * business. Refusing that would just teach the owner to lie about the
 * account.
 */
export async function assertSufficientFunds(
  tx: Tx,
  accountId: number,
  amount: DecimalInput,
  what: string,
): Promise<void> {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  if (account.type !== 'CASH') return;

  const balance = await getAccountBalance(tx, accountId);
  const requested = new Decimal(amount.toString());
  if (requested.lte(balance)) return;

  const short = requested.minus(balance);
  throw AppError.badRequest(
    `${account.name} holds Rs ${balance.toFixed(2)}, which is Rs ${short.toFixed(2)} short of this ${what}. ` +
      'Record the money coming in first, or pay from another account.',
  );
}

export async function getAccountBalance(tx: Tx, accountId: number): Promise<Prisma.Decimal> {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  const credit = await tx.accountTransaction.aggregate({
    where: { accountId, direction: LedgerDirection.CREDIT },
    _sum: { amount: true },
  });
  const debit = await tx.accountTransaction.aggregate({
    where: { accountId, direction: LedgerDirection.DEBIT },
    _sum: { amount: true },
  });
  return new Decimal(account.openingBalance.toString())
    .plus(new Decimal(credit._sum.amount?.toString() ?? 0))
    .minus(new Decimal(debit._sum.amount?.toString() ?? 0));
}
