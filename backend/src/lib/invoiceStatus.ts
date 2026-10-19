import { DocumentStatus, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

export function deriveStatus(total: Prisma.Decimal | number | string, amountPaid: Prisma.Decimal | number | string): DocumentStatus {
  const balance = new Decimal(total).minus(new Decimal(amountPaid));
  return deriveStatusFromBalance(balance, amountPaid);
}

export function deriveStatusFromBalance(
  balance: Prisma.Decimal | number | string,
  amountPaid: Prisma.Decimal | number | string,
): DocumentStatus {
  if (new Decimal(balance).lte(0)) return DocumentStatus.PAID;
  if (new Decimal(amountPaid).gt(0)) return DocumentStatus.PARTIALLY_PAID;
  return DocumentStatus.UNPAID;
}
