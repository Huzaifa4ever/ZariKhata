import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db/prisma';

/**
 * Every transaction that moves stock or money runs under READ COMMITTED,
 * not Prisma/MySQL's default REPEATABLE READ. Reason: REPEATABLE READ fixes
 * a transaction's plain-SELECT snapshot at its first read. Two concurrent
 * sales both take a row lock on the Product (see lib/stock.ts) and
 * correctly serialize their writes — but without this override, the second
 * transaction's *read* of "how much stock is left" can still be answered
 * from a snapshot taken before the first transaction committed, so it can
 * approve a sale that should have been rejected as overselling. READ
 * COMMITTED makes every plain read see the latest committed data, so once
 * a transaction actually acquires its lock, what it reads next is current.
 */
export function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
