import { z } from "zod";

export const AGENT_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_USER",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const agentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export const weeklyCapacityHoursSchema = z.number().finite().min(0).max(168).nullable();

const RUN_TRANSITIONS: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  QUEUED: ["RUNNING", "CANCELLED", "EXPIRED"],
  RUNNING: ["WAITING_FOR_USER", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
  WAITING_FOR_USER: ["RUNNING", "CANCELLED", "EXPIRED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export class AgentGovernanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AgentGovernanceError";
  }
}

export function canTransitionAgentRun(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertAgentRunTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canTransitionAgentRun(from, to)) {
    throw new AgentGovernanceError("INVALID_AGENT_RUN_TRANSITION", `Agent Run 不允许从 ${from} 流转到 ${to}`);
  }
}

export function validateWeeklyCapacityHours(value: unknown): number | null {
  const parsed = weeklyCapacityHoursSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentGovernanceError("INVALID_WEEKLY_CAPACITY", "周标准产能必须为空或 0–168 之间的有限小时数");
  }
  return parsed.data;
}

export function assertManagerAssignment(userId: string, managerId: string | null | undefined): void {
  if (managerId && userId === managerId) {
    throw new AgentGovernanceError("SELF_MANAGER_NOT_ALLOWED", "用户不能成为自己的直属经理");
  }
}

/**
 * 校验组织父节点调整。parentById 必须包含当前可用组织树；未知父节点和已有环均 fail closed。
 */
export function assertOrgParentChange(
  orgUnitId: string,
  candidateParentId: string | null | undefined,
  parentById: ReadonlyMap<string, string | null>,
): void {
  if (!candidateParentId) return;
  if (candidateParentId === orgUnitId) {
    throw new AgentGovernanceError("ORG_SELF_PARENT_NOT_ALLOWED", "组织单元不能以自身为父节点");
  }
  if (!parentById.has(candidateParentId)) {
    throw new AgentGovernanceError("ORG_PARENT_NOT_FOUND", "目标父组织不存在");
  }

  const visited = new Set<string>();
  let cursor: string | null = candidateParentId;
  while (cursor) {
    if (cursor === orgUnitId) {
      throw new AgentGovernanceError("ORG_CYCLE_NOT_ALLOWED", "组织父子关系会形成循环");
    }
    if (visited.has(cursor)) {
      throw new AgentGovernanceError("ORG_TREE_ALREADY_INVALID", "现有组织树包含循环，禁止继续调整");
    }
    visited.add(cursor);
    if (!parentById.has(cursor)) break;
    cursor = parentById.get(cursor) ?? null;
  }
}

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|database[_-]?url|connection[_-]?string)/i;
const MAX_AUDIT_DEPTH = 6;
const MAX_AUDIT_KEYS = 100;
const MAX_AUDIT_ARRAY_ITEMS = 50;
const MAX_AUDIT_STRING_LENGTH = 1_000;

/**
 * 将审计附加数据裁剪为可 JSON 序列化的安全摘要。它不是业务 DTO，也不能替代字段级授权。
 */
export function sanitizeAuditValue(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const visit = (input: unknown, depth: number, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (input === null || input === undefined || typeof input === "number" || typeof input === "boolean") return input ?? null;
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "string") {
      return input.length > MAX_AUDIT_STRING_LENGTH ? `${input.slice(0, MAX_AUDIT_STRING_LENGTH)}…[TRUNCATED]` : input;
    }
    if (input instanceof Date) return input.toISOString();
    if (typeof input !== "object") return String(input);
    if (depth >= MAX_AUDIT_DEPTH) return "[MAX_DEPTH]";
    if (seen.has(input)) return "[CIRCULAR]";
    seen.add(input);

    if (Array.isArray(input)) {
      const values = input.slice(0, MAX_AUDIT_ARRAY_ITEMS).map((item) => visit(item, depth + 1));
      if (input.length > MAX_AUDIT_ARRAY_ITEMS) values.push(`[${input.length - MAX_AUDIT_ARRAY_ITEMS} ITEMS TRUNCATED]`);
      return values;
    }

    const output: Record<string, unknown> = {};
    const entries = Object.entries(input as Record<string, unknown>);
    for (const [entryKey, entryValue] of entries.slice(0, MAX_AUDIT_KEYS)) {
      output[entryKey] = visit(entryValue, depth + 1, entryKey);
    }
    if (entries.length > MAX_AUDIT_KEYS) output.__truncatedKeys = entries.length - MAX_AUDIT_KEYS;
    return output;
  };

  return visit(value, 0);
}
