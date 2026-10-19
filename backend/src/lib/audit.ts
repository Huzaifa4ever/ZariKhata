import type { Prisma } from '@prisma/client';
import type { Tx } from '../db/prisma';

export async function writeAuditLog(
  tx: Tx,
  params: {
    businessId: number;
    userId?: number | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    beforeData?: unknown;
    afterData?: unknown;
    ipAddress?: string | null;
  },
) {
  await tx.auditLog.create({
    data: {
      businessId: params.businessId,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      beforeData: params.beforeData === undefined ? undefined : (params.beforeData as Prisma.InputJsonValue),
      afterData: params.afterData === undefined ? undefined : (params.afterData as Prisma.InputJsonValue),
      ipAddress: params.ipAddress ?? null,
    },
  });
}
