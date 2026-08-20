import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { issueAgentDelegationToken } from "@/lib/agent/delegation";
import {
  DEFAULT_RUNTIME_BUDGET,
  type PersistedCheckpoint,
  type PortableRuntimeState,
  type RunClaim,
  type RunLease,
  type RunTransition,
  type RuntimeBudget,
  type RuntimeControlPlane,
} from "../../../../agent-worker/src/protocol";

export class RuntimeLeaseConflictError extends Error {
  constructor(message = "Run 租约已失效或被其他 Worker 接管") {
    super(message);
    this.name = "RuntimeLeaseConflictError";
  }
}

interface ControlPlaneOptions {
  delegationSecret: string;
  db?: PrismaClient;
  clock?: () => Date;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function runtimeBudget(scopeJson: Prisma.JsonValue | null): RuntimeBudget {
  const scope = scopeJson && typeof scopeJson === "object" && !Array.isArray(scopeJson) ? scopeJson : {};
  const raw = "runtimeBudget" in scope && scope.runtimeBudget && typeof scope.runtimeBudget === "object" && !Array.isArray(scope.runtimeBudget)
    ? scope.runtimeBudget
    : {};
  return {
    maxSteps: boundedInteger("maxSteps" in raw ? raw.maxSteps : undefined, DEFAULT_RUNTIME_BUDGET.maxSteps, 1, 20),
    maxToolCalls: boundedInteger("maxToolCalls" in raw ? raw.maxToolCalls : undefined, DEFAULT_RUNTIME_BUDGET.maxToolCalls, 0, 12),
    maxInputTokens: boundedInteger("maxInputTokens" in raw ? raw.maxInputTokens : undefined, DEFAULT_RUNTIME_BUDGET.maxInputTokens, 1, 100_000),
    maxOutputTokens: boundedInteger("maxOutputTokens" in raw ? raw.maxOutputTokens : undefined, DEFAULT_RUNTIME_BUDGET.maxOutputTokens, 1, 40_000),
    maxToolResultBytes: boundedInteger("maxToolResultBytes" in raw ? raw.maxToolResultBytes : undefined, DEFAULT_RUNTIME_BUDGET.maxToolResultBytes, 1_024, 2 * 1024 * 1024),
    maxDurationMs: boundedInteger("maxDurationMs" in raw ? raw.maxDurationMs : undefined, DEFAULT_RUNTIME_BUDGET.maxDurationMs, 1_000, 10 * 60_000),
    modelTimeoutMs: boundedInteger("modelTimeoutMs" in raw ? raw.modelTimeoutMs : undefined, DEFAULT_RUNTIME_BUDGET.modelTimeoutMs, 100, 120_000),
    toolTimeoutMs: boundedInteger("toolTimeoutMs" in raw ? raw.toolTimeoutMs : undefined, DEFAULT_RUNTIME_BUDGET.toolTimeoutMs, 100, 120_000),
  };
}

function traceId(scopeJson: Prisma.JsonValue | null, runId: string): string {
  if (scopeJson && typeof scopeJson === "object" && !Array.isArray(scopeJson)) {
    const value = "traceId" in scopeJson ? scopeJson.traceId : undefined;
    if (typeof value === "string" && value.length > 0 && value.length <= 128) return value;
  }
  return `agent-${runId}`;
}

function contextProjectId(scopeJson: Prisma.JsonValue | null): string | undefined {
  if (!scopeJson || typeof scopeJson !== "object" || Array.isArray(scopeJson)) return undefined;
  const value = "contextProjectId" in scopeJson ? scopeJson.contextProjectId : undefined;
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

function checkpointJson(state: PortableRuntimeState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

export class PrismaAgentRuntimeControlPlane implements RuntimeControlPlane {
  private readonly db: PrismaClient;
  private readonly configuredClock?: () => Date;

  constructor(private readonly options: ControlPlaneOptions) {
    this.db = options.db ?? prisma;
    this.configuredClock = options.clock;
  }

  private async now(): Promise<Date> {
    if (this.configuredClock) return this.configuredClock();
    const rows = await this.db.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS "now"
    `);
    if (!rows[0]) throw new Error("无法读取 PostgreSQL UTC 时钟");
    return rows[0].now;
  }

  async claimNext(workerId: string, leaseMs: number): Promise<RunClaim | null> {
    if (!workerId || workerId.length > 128) throw new Error("workerId 长度无效");
    const safeLeaseMs = boundedInteger(leaseMs, 30_000, 5_000, 120_000);
    const now = await this.now();
    const leaseExpiresAt = new Date(now.getTime() + safeLeaseMs);
    // 行锁和状态更新必须位于同一事务；SKIP LOCKED 允许多个 Worker 安全争抢不同 Run。
    const row = await this.db.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string; startedAt: Date | null; currentNode: string | null }>>(Prisma.sql`
        SELECT candidate."id", candidate."started_at" AS "startedAt", candidate."current_node" AS "currentNode"
        FROM "Agent_Runs" candidate
        WHERE candidate."cancel_requested_at" IS NULL
          -- Prisma DateTime 映射为 timestamp without time zone；显式使用 UTC 无时区时钟，
          -- 避免数据库会话时区导致原始 SQL 的 Date 参数发生隐式偏移。
          AND (
            candidate."expires_at" IS NULL
            OR candidate."expires_at" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          )
          AND EXISTS (
            SELECT 1 FROM "Agent_Messages" message
            WHERE message."run_id" = candidate."id" AND message."role" = 'user'
          )
          AND (
            candidate."status" = 'QUEUED'
            OR (
              candidate."status" = 'RUNNING'
              AND (
                candidate."lease_expires_at" IS NULL
                OR candidate."lease_expires_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              )
            )
          )
        ORDER BY candidate."created_at" ASC, candidate."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const candidate = candidates[0];
      if (!candidate) return null;
      return tx.agentRun.update({
        where: { id: candidate.id },
        data: {
          status: "RUNNING",
          currentNode: candidate.currentNode ?? "start",
          leaseOwnerId: workerId,
          leaseExpiresAt,
          leaseVersion: { increment: 1 },
          heartbeatAt: now,
          startedAt: candidate.startedAt ?? now,
        },
        select: {
          id: true,
          userId: true,
          sessionId: true,
          leaseVersion: true,
          leaseExpiresAt: true,
          promptVersion: true,
          scopeJson: true,
          createdAt: true,
          expiresAt: true,
        },
      });
    });
    if (!row) return null;
    const message = await this.db.agentMessage.findFirst({
      where: { runId: row.id, role: "user" },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
      select: { content: true },
    });
    if (!message?.content) throw new Error("已领取 Run 缺少用户问题");
    const delegationExpiresAt = new Date(
      Math.min(now.getTime() + 5 * 60_000, row.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
    );
    const runTraceId = traceId(row.scopeJson, row.id);
    const runContextProjectId = contextProjectId(row.scopeJson);
    return {
      lease: {
        runId: row.id,
        workerId,
        version: row.leaseVersion,
        expiresAt: row.leaseExpiresAt!.toISOString(),
      },
      traceId: runTraceId,
      sessionId: row.sessionId,
      question: message.content,
      ...(runContextProjectId ? { contextProjectId: runContextProjectId } : {}),
      delegationToken: issueAgentDelegationToken(this.options.delegationSecret, {
        runId: row.id,
        traceId: runTraceId,
        sessionId: row.sessionId,
        sessionSubject: row.userId,
        issuedAt: now.toISOString(),
        expiresAt: delegationExpiresAt.toISOString(),
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      }),
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      promptVersion: row.promptVersion ?? "plm-agent-system@1.2.0",
      budget: runtimeBudget(row.scopeJson),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async assertLease(lease: RunLease): Promise<void> {
    const now = await this.now();
    const run = await this.db.agentRun.findFirst({
      where: {
        id: lease.runId,
        status: "RUNNING",
        leaseOwnerId: lease.workerId,
        leaseVersion: lease.version,
        leaseExpiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!run) throw new RuntimeLeaseConflictError();
  }

  async loadLatestCheckpoint(lease: RunLease): Promise<PersistedCheckpoint | null> {
    await this.assertLease(lease);
    const checkpoint = await this.db.agentCheckpoint.findFirst({
      where: { runId: lease.runId, checkpointNs: "runtime-v1" },
      orderBy: [{ createdAt: "desc" }, { checkpointId: "desc" }],
    });
    if (!checkpoint) return null;
    return {
      checkpointId: checkpoint.checkpointId,
      ...(checkpoint.parentCheckpointId ? { parentCheckpointId: checkpoint.parentCheckpointId } : {}),
      state: checkpoint.stateJson as unknown as PortableRuntimeState,
      createdAt: checkpoint.createdAt.toISOString(),
    };
  }

  async heartbeat(lease: RunLease, leaseMs: number): Promise<RunLease> {
    const now = await this.now();
    const safeLeaseMs = boundedInteger(leaseMs, 30_000, 5_000, 120_000);
    const expiresAt = new Date(now.getTime() + safeLeaseMs);
    const updated = await this.db.agentRun.updateMany({
      where: {
        id: lease.runId,
        status: "RUNNING",
        leaseOwnerId: lease.workerId,
        leaseVersion: lease.version,
        leaseExpiresAt: { gt: now },
      },
      data: { heartbeatAt: now, leaseExpiresAt: expiresAt },
    });
    if (updated.count !== 1) throw new RuntimeLeaseConflictError();
    return { ...lease, expiresAt: expiresAt.toISOString() };
  }

  async isCancellationRequested(lease: RunLease): Promise<boolean> {
    await this.assertLease(lease);
    const run = await this.db.agentRun.findUnique({
      where: { id: lease.runId },
      select: { cancelRequestedAt: true },
    });
    return Boolean(run?.cancelRequestedAt);
  }

  async saveCheckpoint(
    lease: RunLease,
    checkpoint: Omit<PersistedCheckpoint, "createdAt">,
  ): Promise<void> {
    const now = await this.now();
    await this.db.$transaction(async (tx) => {
      const active = await tx.agentRun.updateMany({
        where: {
          id: lease.runId,
          status: "RUNNING",
          leaseOwnerId: lease.workerId,
          leaseVersion: lease.version,
          leaseExpiresAt: { gt: now },
        },
        data: {
          currentNode: checkpoint.state.lastNode,
          stepCount: checkpoint.state.stepCount,
          toolCallCount: checkpoint.state.toolCallCount,
          resultBytes: checkpoint.state.resultBytes,
          inputTokenCount: checkpoint.state.inputTokenCount,
          outputTokenCount: checkpoint.state.outputTokenCount,
          estimatedCostMicros: checkpoint.state.estimatedCostMicros,
        },
      });
      if (active.count !== 1) throw new RuntimeLeaseConflictError();
      await tx.agentCheckpoint.upsert({
        where: {
          runId_checkpointNs_checkpointId: {
            runId: lease.runId,
            checkpointNs: "runtime-v1",
            checkpointId: checkpoint.checkpointId,
          },
        },
        update: {},
        create: {
          runId: lease.runId,
          checkpointNs: "runtime-v1",
          checkpointId: checkpoint.checkpointId,
          parentCheckpointId: checkpoint.parentCheckpointId ?? null,
          stateJson: checkpointJson(checkpoint.state),
          metadataJson: {
            schemaVersion: checkpoint.state.schemaVersion,
            node: checkpoint.state.lastNode,
            phase: checkpoint.state.phase,
          },
        },
      });
    });
  }

  async appendEvent(
    lease: RunLease,
    event: { sequence: number; eventType: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.assertLease(lease);
    await this.db.agentRunEvent.upsert({
      where: { runId_sequence: { runId: lease.runId, sequence: event.sequence } },
      update: {},
      create: {
        runId: lease.runId,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  async transition(lease: RunLease, requested: RunTransition): Promise<void> {
    const now = await this.now();
    await this.db.$transaction(async (tx) => {
      const run = await tx.agentRun.findFirst({
        where: {
          id: lease.runId,
          status: "RUNNING",
          leaseOwnerId: lease.workerId,
          leaseVersion: lease.version,
          leaseExpiresAt: { gt: now },
        },
        select: { id: true, cancelRequestedAt: true },
      });
      if (!run) throw new RuntimeLeaseConflictError();
      const transition: RunTransition =
        run.cancelRequestedAt && requested.status !== "CANCELLED"
          ? { ...requested, status: "CANCELLED", failureCode: "RUN_CANCELLED", failureMessage: "用户已取消 Agent Run", answer: undefined }
          : requested;
      const terminal = transition.status !== "WAITING_FOR_USER";
      const updated = await tx.agentRun.updateMany({
        where: {
          id: lease.runId,
          status: "RUNNING",
          leaseOwnerId: lease.workerId,
          leaseVersion: lease.version,
        },
        data: {
          status: transition.status,
          currentNode: transition.currentNode,
          completedAt: terminal ? now : null,
          heartbeatAt: now,
          leaseOwnerId: null,
          leaseExpiresAt: null,
          failureCode: transition.failureCode ?? null,
          failureMessage: transition.failureMessage?.slice(0, 1_000) ?? null,
          inputTokenCount: transition.usage.inputTokens,
          outputTokenCount: transition.usage.outputTokens,
          estimatedCostMicros: transition.usage.estimatedCostMicros ?? 0,
          stepCount: transition.usage.stepCount,
          toolCallCount: transition.usage.toolCallCount,
          resultBytes: transition.usage.resultBytes,
        },
      });
      if (updated.count !== 1) throw new RuntimeLeaseConflictError();

      if (transition.answer) {
        const lastMessage = await tx.agentMessage.findFirst({
          where: { runId: lease.runId },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        });
        await tx.agentMessage.create({
          data: {
            runId: lease.runId,
            sequence: (lastMessage?.sequence ?? -1) + 1,
            role: "assistant",
            content: transition.answer,
            contentJson: { status: transition.status },
          },
        });
      }
      const lastEvent = await tx.agentRunEvent.findFirst({
        where: { runId: lease.runId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      await tx.agentRunEvent.create({
        data: {
          runId: lease.runId,
          sequence: (lastEvent?.sequence ?? 0) + 1,
          eventType: `RUN_${transition.status}`,
          payload: {
            node: transition.currentNode,
            failureCode: transition.failureCode ?? null,
            stepCount: transition.usage.stepCount,
            toolCallCount: transition.usage.toolCallCount,
          },
        },
      });
    });
  }
}
