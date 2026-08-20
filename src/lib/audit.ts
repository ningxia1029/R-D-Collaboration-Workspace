// 审计日志 helper
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { sanitizeAuditValue } from "@/lib/agent/governance";

export async function writeAudit(params: {
  userId?: string | null;
  projectId?: string | null;
  correlationId?: string | null;
  eventType?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff?: unknown;
  metadata?: unknown;
}, tx?: Prisma.TransactionClient) {
  try {
    await (tx ?? prisma).auditLog.create({
      data: {
        userId: params.userId ?? null,
        projectId: params.projectId ?? null,
        correlationId: params.correlationId ?? null,
        eventType: params.eventType ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        diffJson: params.diff === undefined ? null : JSON.stringify(sanitizeAuditValue(params.diff)),
        metadataJson: params.metadata === undefined ? null : JSON.stringify(sanitizeAuditValue(params.metadata)),
      },
    });
  } catch (e) {
    // 事务内审计属于业务一致性的一部分；非事务辅助审计仍保持原有容错语义。
    if (tx) throw e;
    console.error("[audit] 写入失败", e);
  }
}
