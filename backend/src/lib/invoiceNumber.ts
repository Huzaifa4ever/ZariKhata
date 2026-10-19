import { SequenceType } from '@prisma/client';
import type { Tx } from '../db/prisma';

// Must be called inside the same prisma.$transaction() as the rest of the
// invoice/return creation. The UPDATE below takes an InnoDB row lock on the
// InvoiceSequence row that is held until the transaction commits or rolls
// back, so two concurrent requests for the same business+type serialize on
// this row instead of ever handing out the same number.
export async function nextInvoiceNumber(
  tx: Tx,
  businessId: number,
  type: SequenceType,
): Promise<string> {
  const sequence = await tx.invoiceSequence.findUnique({
    where: { businessId_type: { businessId, type } },
  });
  if (!sequence) {
    throw new Error(
      `No InvoiceSequence row for business ${businessId} / ${type}. Run ensureInvoiceSequences first.`,
    );
  }
  const updated = await tx.invoiceSequence.update({
    where: { id: sequence.id },
    data: { currentNumber: { increment: 1 } },
  });
  const padded = String(updated.currentNumber).padStart(5, '0');
  return `${updated.prefix}-${padded}`;
}

export async function ensureInvoiceSequences(
  tx: Tx,
  businessId: number,
  prefixes: { salesInvoicePrefix: string; purchaseInvoicePrefix: string },
): Promise<void> {
  const defs: Array<{ type: SequenceType; prefix: string }> = [
    { type: SequenceType.SALE, prefix: prefixes.salesInvoicePrefix },
    { type: SequenceType.PURCHASE, prefix: prefixes.purchaseInvoicePrefix },
    { type: SequenceType.SALE_RETURN, prefix: `${prefixes.salesInvoicePrefix}R` },
    { type: SequenceType.PURCHASE_RETURN, prefix: `${prefixes.purchaseInvoicePrefix}R` },
  ];
  for (const def of defs) {
    await tx.invoiceSequence.upsert({
      where: { businessId_type: { businessId, type: def.type } },
      create: { businessId, type: def.type, prefix: def.prefix, currentNumber: 0 },
      update: {},
    });
  }
}
