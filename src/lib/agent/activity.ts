import type { Prisma } from "@prisma/client";
import { sanitizeAuditValue } from "@/lib/agent/governance";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return sanitizeAuditValue(value) as Prisma.InputJsonValue;
}

/** 在业务事务内追加结构化活动；周报只消费这些事实事件，不从当前快照反推历史。 */
export function writeActivityEvent(
  tx: Prisma.TransactionClient,
  params: {
    projectId?: string | null;
    actorUserId?: string | null;
    eventType: string;
    entityType: string;
    entityId: string;
    correlationId?: string | null;
    payload?: unknown;
    occurredAt?: Date;
  },
) {
  return tx.activityEvent.create({
    data: {
      projectId: params.projectId ?? null,
      actorUserId: params.actorUserId ?? null,
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: params.entityId,
      correlationId: params.correlationId ?? null,
      payloadJson: params.payload === undefined ? undefined : jsonValue(params.payload),
      occurredAt: params.occurredAt ?? new Date(),
    },
  });
}

/** Outbox 必须与业务写入使用同一事务，索引器随后按 dedupKey 幂等消费。 */
export function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  params: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    dedupKey: string;
    payload: unknown;
    availableAt?: Date;
  },
) {
  return tx.outboxEvent.create({
    data: {
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      dedupKey: params.dedupKey,
      payloadJson: jsonValue(params.payload),
      availableAt: params.availableAt ?? new Date(),
    },
  });
}

export function documentIndexDedupKey(documentId: string, revision: string): string {
  return `agent-document-index:${documentId}:${revision}`;
}
