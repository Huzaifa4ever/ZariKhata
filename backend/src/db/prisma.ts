import { Prisma, PrismaClient } from '@prisma/client';

// Single shared client for the process. Reused across hot-reloads in dev via
// a global to avoid exhausting MySQL connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type Tx = Prisma.TransactionClient;
