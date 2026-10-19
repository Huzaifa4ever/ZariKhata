import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

export interface AllocatableInvoice {
  id: number;
  balance: Prisma.Decimal | string;
}

export interface Allocation {
  invoiceId: number;
  amount: Prisma.Decimal;
}

/**
 * Default allocation rule: oldest outstanding invoices first. `invoices`
 * must already be sorted oldest-first by the caller. Any amount left over
 * after every invoice is fully covered is returned as `unallocated` — an
 * overpayment becomes a credit balance on the party's ledger rather than
 * being forced onto an invoice (see farmerPayments/supplierPayments
 * services for how that's documented to the user).
 */
export function allocateOldestFirst(
  invoices: AllocatableInvoice[],
  amount: Prisma.Decimal | number | string,
): { allocations: Allocation[]; unallocated: Prisma.Decimal } {
  let remaining = new Decimal(amount);
  const allocations: Allocation[] = [];

  for (const invoice of invoices) {
    if (remaining.lte(0)) break;
    const balance = new Decimal(invoice.balance.toString());
    if (balance.lte(0)) continue;
    const take = Decimal.min(balance, remaining);
    allocations.push({ invoiceId: invoice.id, amount: take });
    remaining = remaining.minus(take);
  }

  return { allocations, unallocated: remaining };
}
