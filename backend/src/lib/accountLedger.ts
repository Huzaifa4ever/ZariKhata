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

/**
 * Whether paying this much out of this account would overdraw it.
 *
 * Deliberately a question, not a rule. An earlier version of this threw and
 * blocked the payment, which was wrong: the books lag reality in a shop that
 * has just started keeping them, so a cash account reading zero usually means
 * the takings were never entered, not that the drawer is empty. Refusing the
 * payment does not make the money appear - it just stops the shopkeeper
 * recording something that genuinely happened, and the real event ends up
 * nowhere.
 *
 * So the figure is reported and never enforced. The UI warns before saving,
 * the dashboard shows a negative balance in red, and the cash book on the
 * Accounts page exists to find whatever is missing - but the person at the
 * counter is the one who knows what is in the drawer.
 */
export async function wouldOverdraw(
  tx: Tx,
  accountId: number,
  amount: DecimalInput,
): Promise<{ overdrawn: boolean; balance: Prisma.Decimal; shortBy: Prisma.Decimal }> {
  const balance = await getAccountBalance(tx, accountId);
  const shortBy = new Decimal(amount.toString()).minus(balance);
  return { overdrawn: shortBy.gt(0), balance, shortBy };
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
