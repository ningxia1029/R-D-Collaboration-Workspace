import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAgentControlSnapshot } from "@/lib/agent/control";
import { clarificationFromState, presentToolResults } from "@/lib/agent/presenter";
import { ApiError, requireProjectAccess, type SessionUser } from "@/lib/rbac";
import { PrismaActionService } from "@/lib/agent/actions/service";
import type { PortableRuntimeState } from "../../../agent-worker/src/protocol";

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);
const RETENTION_DAYS = 30;
const RUN_EXPIRY_MINUTES = 15;

export const createRunInputSchema = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    projectId: z.string().min(1).max(128).optional(),
    sessionId: z.string().uuid().optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .strict();

export const resumeRunInputSchema = z.object({ message: z.string().trim().min(1).max(2_000) }).strict();

function inputHash(question: string): string {
  return createHash("sha256").update(question.normalize("NFKC"), "utf8").digest("hex");
}

function runIdempotencyKey(userId: string, key?: string): string | null {
  return key ? createHash("sha256").update(`agent-run:${userId}:${key}`, "utf8").digest("hex") : null;
}

function contentMayContainSecret(question: string): boolean {
  return /(?:password|passwd|api[_ -]?key|access[_ -]?token|authorization|数据库连接串|密码|密钥|令牌)\s*[:=]/i.test(question);
}

function retentionUntil(now: Date): Date {
  return new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60_000);
}

function expiresAt(now: Date): Date {
  return new Date(now.getTime() + RUN_EXPIRY_MINUTES * 60_000);
}

export async function assertAgentOperational(db: PrismaClient = prisma): Promise<void> {
  const control = await getAgentControlSnapshot(db);
  if (!control.enabled) throw new ApiError(503, control.maintenanceMessage ?? "企业智能体当前未启用");
  if (!control.configurationReady) throw new ApiError(503, "企业智能体配置尚未就绪，请联系管理员");
}

export async function createAgentRun(
  user: SessionUser,
  input: z.infer<typeof createRunInputSchema>,
  db: PrismaClient = prisma,
) {
  const parsed = createRunInputSchema.parse(input);
  const idempotencyKey = runIdempotencyKey(user.id, parsed.idempotencyKey);
  if (idempotencyKey) {
    const existing = await db.agentRun.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.userId !== user.id) throw new ApiError(409, "幂等键已被占用");
      return existing;
    }
  }
  await assertAgentOperational(db);
  if (parsed.projectId) await requireProjectAccess(user, parsed.projectId);

  const now = new Date();
  const traceId = randomUUID();
  try {
    return await db.$transaction(async (tx) => {
      const run = await tx.agentRun.create({
        data: {
          userId: user.id,
          sessionId: parsed.sessionId ?? randomUUID(),
          status: "QUEUED",
          currentNode: "queued",
          promptVersion: "plm-agent-system@1.2.0",
          inputHash: inputHash(parsed.question),
          scopeJson: { traceId, contextProjectId: parsed.projectId ?? null },
          idempotencyKey,
          containsSensitiveData: contentMayContainSecret(parsed.question),
          expiresAt: expiresAt(now),
          retentionUntil: retentionUntil(now),
          messages: { create: { sequence: 0, role: "user", content: parsed.question } },
          events: { create: { sequence: 1, eventType: "RUN_QUEUED", payload: { traceId } } },
        },
      });
      return run;
    });
  } catch (error: unknown) {
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.agentRun.findUnique({ where: { idempotencyKey } });
      if (existing?.userId === user.id) return existing;
    }
    throw error;
  }
}

export async function listAgentRuns(userId: string, take: number, db: PrismaClient = prisma) {
  const rows = await db.agentRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, take)),
    select: {
      id: true,
      sessionId: true,
      status: true,
      currentNode: true,
      failureCode: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      messages: { orderBy: { sequence: "asc" }, take: 1, select: { content: true } },
    },
  });
  return rows.map(({ messages, ...run }) => ({ ...run, question: messages[0]?.content ?? "" }));
}

export async function getOwnedAgentRun(user: SessionUser, runId: string, db: PrismaClient = prisma) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, userId: user.id },
    include: {
      messages: { orderBy: { sequence: "asc" }, select: { id: true, sequence: true, role: true, content: true, createdAt: true } },
      events: { orderBy: { sequence: "asc" }, take: 200, select: { sequence: true, eventType: true, payload: true, createdAt: true } },
      checkpoints: { orderBy: [{ createdAt: "desc" }, { checkpointId: "desc" }], take: 1, select: { stateJson: true } },
    },
  });
  if (!run) throw new ApiError(404, "Agent Run 不存在");
  const state = run.checkpoints[0]?.stateJson;
  if (user.roleName !== "admin") {
    const scope = run.scopeJson && typeof run.scopeJson === "object" && !Array.isArray(run.scopeJson) ? run.scopeJson : {};
    const contextProjectId = "contextProjectId" in scope && typeof scope.contextProjectId === "string" ? scope.contextProjectId : null;
    const projectIds = new Set<string>(contextProjectId ? [contextProjectId] : []);
    for (const result of presentToolResults(state)) {
      for (const projectId of result.scope?.projectIds ?? []) projectIds.add(projectId);
    }
    if (projectIds.size > 0) {
      const visibleCount = await db.projectMember.count({
        where: { userId: user.id, projectId: { in: Array.from(projectIds) } },
      });
      if (visibleCount !== projectIds.size) throw new ApiError(404, "Agent Run 不存在");
    }
  }
  const { checkpoints: _checkpoints, ...safeRun } = run;
  const actionProposals = await new PrismaActionService(db).listOwnedProposals(user, run.id);
  return {
    ...safeRun,
    clarification: clarificationFromState(state),
    toolResults: presentToolResults(state),
    actionProposals,
    canCancel: ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status),
    canResume: run.status === "WAITING_FOR_USER",
    canRetry: TERMINAL_STATUSES.has(run.status),
  };
}

async function nextSequences(tx: Prisma.TransactionClient, runId: string) {
  const [message, event] = await Promise.all([
    tx.agentMessage.findFirst({ where: { runId }, orderBy: { sequence: "desc" }, select: { sequence: true } }),
    tx.agentRunEvent.findFirst({ where: { runId }, orderBy: { sequence: "desc" }, select: { sequence: true } }),
  ]);
  return { message: (message?.sequence ?? -1) + 1, event: (event?.sequence ?? 0) + 1 };
}

export async function cancelOwnedAgentRun(userId: string, runId: string, db: PrismaClient = prisma) {
  return db.$transaction(async (tx) => {
    const run = await tx.agentRun.findFirst({ where: { id: runId, userId } });
    if (!run) throw new ApiError(404, "Agent Run 不存在");
    if (TERMINAL_STATUSES.has(run.status)) return run;
    const now = new Date();
    const sequences = await nextSequences(tx, run.id);
    if (run.status === "RUNNING") {
      const updated = await tx.agentRun.updateMany({
        where: { id: run.id, userId, status: "RUNNING", cancelRequestedAt: null },
        data: { cancelRequestedAt: now },
      });
      if (updated.count === 0) throw new ApiError(409, "Run 状态已变化，请刷新后重试");
      await tx.agentRunEvent.create({
        data: { runId: run.id, sequence: sequences.event, eventType: "RUN_CANCEL_REQUESTED", payload: {} },
      });
    } else {
      const updated = await tx.agentRun.updateMany({
        where: { id: run.id, userId, status: { in: ["QUEUED", "WAITING_FOR_USER"] } },
        data: { status: "CANCELLED", currentNode: "cancelled_by_user", cancelRequestedAt: now, completedAt: now },
      });
      if (updated.count === 0) throw new ApiError(409, "Run 状态已变化，请刷新后重试");
      await tx.agentRunEvent.create({
        data: { runId: run.id, sequence: sequences.event, eventType: "RUN_CANCELLED", payload: { by: "user" } },
      });
    }
    return tx.agentRun.findUniqueOrThrow({ where: { id: run.id } });
  });
}

export async function resumeOwnedAgentRun(
  userId: string,
  runId: string,
  message: string,
  db: PrismaClient = prisma,
) {
  const parsed = resumeRunInputSchema.parse({ message });
  await assertAgentOperational(db);
  return db.$transaction(async (tx) => {
    const run = await tx.agentRun.findFirst({
      where: { id: runId, userId },
      include: { checkpoints: { orderBy: [{ createdAt: "desc" }, { checkpointId: "desc" }], take: 1 } },
    });
    if (!run) throw new ApiError(404, "Agent Run 不存在");
    if (run.status !== "WAITING_FOR_USER") throw new ApiError(409, "当前 Run 不等待用户补充");
    const checkpoint = run.checkpoints[0];
    const state = checkpoint?.stateJson as unknown as PortableRuntimeState | undefined;
    if (!checkpoint || state?.schemaVersion !== "1.0") throw new ApiError(409, "Run 缺少可恢复检查点");
    const sequences = await nextSequences(tx, run.id);
    const resumedState: PortableRuntimeState = {
      ...state,
      question: `${state.question}\n\n用户补充：${parsed.message}`,
      phase: "PLAN",
      clarification: undefined,
      answer: undefined,
      pendingTool: undefined,
      eventSequence: state.eventSequence + 1,
      lastNode: "user_resume",
    };
    const updated = await tx.agentRun.updateMany({
      where: { id: run.id, userId, status: "WAITING_FOR_USER" },
      data: {
        status: "QUEUED",
        currentNode: "user_resume",
        cancelRequestedAt: null,
        completedAt: null,
        expiresAt: expiresAt(new Date()),
      },
    });
    if (updated.count !== 1) throw new ApiError(409, "Run 状态已变化，请刷新后重试");
    await tx.agentMessage.create({ data: { runId: run.id, sequence: sequences.message, role: "user", content: parsed.message } });
    await tx.agentCheckpoint.create({
      data: {
        runId: run.id,
        checkpointNs: "runtime-v1",
        checkpointId: `resume-${randomUUID()}`,
        parentCheckpointId: checkpoint.checkpointId,
        stateJson: resumedState as unknown as Prisma.InputJsonValue,
        metadataJson: { source: "user_resume" },
      },
    });
    await tx.agentRunEvent.create({
      data: { runId: run.id, sequence: sequences.event, eventType: "RUN_RESUMED", payload: { source: "user" } },
    });
    return tx.agentRun.findUniqueOrThrow({ where: { id: run.id } });
  });
}

export async function retryOwnedAgentRun(user: SessionUser, runId: string, db: PrismaClient = prisma) {
  const source = await db.agentRun.findFirst({
    where: { id: runId, userId: user.id },
    include: { messages: { where: { role: "user" }, orderBy: { sequence: "asc" }, take: 1 } },
  });
  if (!source) throw new ApiError(404, "Agent Run 不存在");
  if (!TERMINAL_STATUSES.has(source.status)) throw new ApiError(409, "仅终态 Run 可以安全重试");
  const question = source.messages[0]?.content;
  if (!question) throw new ApiError(409, "原 Run 缺少问题正文");
  const scope = source.scopeJson && typeof source.scopeJson === "object" && !Array.isArray(source.scopeJson) ? source.scopeJson : {};
  const projectId = "contextProjectId" in scope && typeof scope.contextProjectId === "string" ? scope.contextProjectId : undefined;
  return createAgentRun(user, { question, projectId, sessionId: source.sessionId }, db);
}
