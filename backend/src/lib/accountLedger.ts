import { Prisma, LedgerDirection } from '@prisma/client';
import type { Tx } from '../db/prisma';
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
