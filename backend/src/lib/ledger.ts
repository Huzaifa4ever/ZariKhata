import { Prisma, LedgerDirection, PartyType } from '@prisma/client';
import type { Tx } from '../db/prisma';
const Decimal = Prisma.Decimal;
type DecimalInput = string | number | Prisma.Decimal;

// Convention (documented on the LedgerEntry model too): DEBIT always
// increases the outstanding balance, CREDIT always decreases it, for either
// party type. A credit sale or credit purchase is a DEBIT (farmer owes more /
// we owe the supplier more); a payment received or paid, or a return, is a
// CREDIT (less outstanding either way).
export async function recordLedgerEntry(
  tx: Tx,
  params: {
    businessId: number;
    partyType: PartyType;
    farmerId?: number;
    supplierId?: number;
    direction: LedgerDirection;
    amount: DecimalInput;
    relatedType: string;
    relatedId: number;
    description?: string;
    entryDate?: Date;
  },
) {
  await tx.ledgerEntry.create({
    data: {
      businessId: params.businessId,
      partyType: params.partyType,
      farmerId: params.farmerId,
      supplierId: params.supplierId,
      direction: params.direction,
      amount: params.amount.toString(),
      relatedType: params.relatedType,
      relatedId: params.relatedId,
      description: params.description,
      entryDate: params.entryDate ?? new Date(),
    },
  });
}

async function sumLedger(tx: Tx, where: Prisma.LedgerEntryWhereInput, direction: LedgerDirection) {
  const result = await tx.ledgerEntry.aggregate({ where: { ...where, direction }, _sum: { amount: true } });
  return new Decimal(result._sum.amount?.toString() ?? 0);
}

export async function getFarmerBalance(tx: Tx, farmerId: number): Promise<Prisma.Decimal> {
  const farmer = await tx.farmer.findUniqueOrThrow({ where: { id: farmerId } });
  const where = { partyType: PartyType.FARMER, farmerId };
  const debit = await sumLedger(tx, where, LedgerDirection.DEBIT);
  const credit = await sumLedger(tx, where, LedgerDirection.CREDIT);
  return new Decimal(farmer.openingBalance.toString()).plus(debit).minus(credit);
}

export async function getSupplierBalance(tx: Tx, supplierId: number): Promise<Prisma.Decimal> {
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const where = { partyType: PartyType.SUPPLIER, supplierId };
  const debit = await sumLedger(tx, where, LedgerDirection.DEBIT);
  const credit = await sumLedger(tx, where, LedgerDirection.CREDIT);
  return new Decimal(supplier.openingBalance.toString()).plus(debit).minus(credit);
}
