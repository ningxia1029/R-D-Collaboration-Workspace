// 审计日志 helper
import { prisma } from "@/lib/prisma";

export async function writeAudit(params: {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        diffJson: params.diff ? JSON.stringify(params.diff) : null,
      },
    });
  } catch (e) {
    // 审计失败不阻断主流程
    console.error("[audit] 写入失败", e);
  }
}
