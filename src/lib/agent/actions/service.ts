import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { writeActivityEvent } from "@/lib/agent/activity";
import {
  configuredActionApprovalSecret,
  issueApprovalToken,
  verifyApprovalToken,
} from "@/lib/agent/actions/token";
import { actionDefinition } from "@/lib/agent/actions/registry";
import type { TaskUpdateProposalInput, ToolExecutionContext } from "@/lib/agent/tools/contracts";
import type {
  TaskUpdateProposalRecord,
  ToolActionProposalService,
} from "@/lib/agent/tools/types";
import { ROLE_NAMES, type RoleName } from "@/lib/constants";
import { ApiError, roleHasPerm, type SessionUser } from "@/lib/rbac";
import { indexEntity } from "@/lib/services/searchService";

const PROPOSAL_TTL_MS = 15 * 60_000;
const CONFIRMATION_TEXT = "确认执行";
const actionProposalStatusSchema = z.enum(["PENDING", "APPROVED", "EXPIRED", "CANCELLED", "EXECUTED", "REJECTED", "CONFLICT", "FAILED"]);

const taskChangeSchema = z
  .object({
    description: z.string().max(10_000).nullable().optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    dueDate: z.iso.date().nullable().optional(),
    estimatedHours: z.number().finite().min(0).max(100_000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少需要一个变更字段");

const taskValueSchema = z.union([z.string(), z.number(), z.null()]);
const taskProposalDocumentSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    actionType: z.literal("TASK_UPDATE_LOW_RISK"),
    target: z.object({ taskId: z.string(), projectId: z.string(), title: z.string() }).strict(),
    changes: taskChangeSchema,
    before: z.record(z.string(), taskValueSchema),
    after: z.record(z.string(), taskValueSchema),
    reason: z.string().nullable(),
    traceId: z.string(),
    requestId: z.string(),
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const executeActionInputSchema = z
  .object({
    approvalToken: z.string().min(32).max(4_096),
    confirmationText: z.literal(CONFIRMATION_TEXT),
    expectedVersion: z.iso.datetime({ offset: true }),
  })
  .strict();

type JsonTaskValue = string | number | null;
type TaskFieldMap = Record<string, JsonTaskValue>;
type ActionDb = Prisma.TransactionClient | PrismaClient;

interface TaskPermissionResult {
  allowed: boolean;
  permissionsApplied: string[];
}

interface ProposalViewRow {
  id: string;
  runId: string;
  status: string;
  actionType: string;
  riskLevel: string;
  expectedVersion: string | null;
  proposalJson: Prisma.JsonValue;
  approvalNonceHash: string | null;
  executionResultJson: Prisma.JsonValue | null;
  readbackJson: Prisma.JsonValue | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
}

export interface ActionProposalView {
  id: string;
  runId: string;
  status: string;
  actionType: string;
  riskLevel: string;
  target: { taskId: string; projectId: string; title: string };
  before: TaskFieldMap;
  after: TaskFieldMap;
  reason: string | null;
  expectedVersion: string;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  canExecute: boolean;
  approvalToken: string | null;
  confirmationText: typeof CONFIRMATION_TEXT;
  executionResult: unknown;
  readback: unknown;
  failure: { code: string; message: string } | null;
}

export interface ActionExecutionResult {
  proposalId: string;
  status: "EXECUTED";
  executionIdempotencyKey: string;
  readback: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    priority: string;
    dueDate: string | null;
    estimatedHours: number | null;
    updatedAt: string;
  };
  auditCorrelationId: string;
  replayed: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}

function normalizeChanges(value: TaskUpdateProposalInput["changes"]): z.infer<typeof taskChangeSchema> {
  const normalized: Record<string, unknown> = { ...value };
  if (typeof normalized.description === "string") {
    normalized.description = normalized.description.trim() || null;
  }
  return taskChangeSchema.parse(normalized);
}

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function taskFieldValue(task: {
  description: string | null;
  priority: string;
  dueDate: Date | null;
  estimatedHours: number | null;
}, field: string): JsonTaskValue {
  if (field === "description") return task.description;
  if (field === "priority") return task.priority;
  if (field === "dueDate") return dateOnly(task.dueDate);
  if (field === "estimatedHours") return task.estimatedHours;
  throw new ApiError(400, `不允许变更任务字段：${field}`);
}

function taskBeforeAfter(
  task: { description: string | null; priority: string; dueDate: Date | null; estimatedHours: number | null },
  changes: z.infer<typeof taskChangeSchema>,
): { before: TaskFieldMap; after: TaskFieldMap } {
  const before: TaskFieldMap = {};
  const after: TaskFieldMap = {};
  for (const [field, value] of Object.entries(changes)) {
    before[field] = taskFieldValue(task, field);
    after[field] = value as JsonTaskValue;
  }
  if (Object.keys(after).every((field) => before[field] === after[field])) {
    throw new ApiError(409, "动作提议没有实际字段变化");
  }
  return { before, after };
}

function taskPatch(changes: z.infer<typeof taskChangeSchema>): Prisma.TaskUpdateManyMutationInput {
  return {
    ...(Object.prototype.hasOwnProperty.call(changes, "description") ? { description: changes.description } : {}),
    ...(Object.prototype.hasOwnProperty.call(changes, "priority") ? { priority: changes.priority } : {}),
    ...(Object.prototype.hasOwnProperty.call(changes, "dueDate")
      ? { dueDate: changes.dueDate ? new Date(`${changes.dueDate}T00:00:00.000Z`) : null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(changes, "estimatedHours") ? { estimatedHours: changes.estimatedHours } : {}),
  };
}

async function taskPermission(
  db: ActionDb,
  userId: string,
  projectId: string,
  task: { assigneeId: string | null; createdBy: string | null },
): Promise<TaskPermissionResult> {
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, role: { select: { name: true } } },
  });
  if (!actor || actor.status !== "active" || !isRoleName(actor.role.name)) {
    return { allowed: false, permissionsApplied: [] };
  }
  if (actor.role.name === "admin") return { allowed: true, permissionsApplied: ["task:update", "admin"] };
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: { select: { name: true } } },
  });
  if (!member) return { allowed: false, permissionsApplied: [] };
  const effective = member.role?.name && isRoleName(member.role.name) ? member.role.name : actor.role.name;
  if (roleHasPerm(effective, "task:update")) {
    return { allowed: true, permissionsApplied: ["task:update", "project_membership"] };
  }
  const ownsTask = task.assigneeId === userId || task.createdBy === userId;
  if (ownsTask && roleHasPerm(effective, "task:update_own")) {
    return { allowed: true, permissionsApplied: ["task:update_own", "own_task", "project_membership"] };
  }
  return { allowed: false, permissionsApplied: [] };
}

function proposalRecord(row: ProposalViewRow): TaskUpdateProposalRecord {
  const proposal = taskProposalDocumentSchema.parse(row.proposalJson);
  if (!row.expectedVersion) throw new ApiError(500, "动作提议缺少预期版本");
  return {
    proposalId: row.id,
    approvalRequestId: row.id,
    actionType: "TASK_UPDATE_LOW_RISK",
    status: actionProposalStatusSchema.parse(row.status === "PENDING" && row.expiresAt <= new Date() ? "EXPIRED" : row.status),
    riskLevel: "LOW",
    target: proposal.target,
    before: proposal.before,
    after: proposal.after,
    expectedVersion: row.expectedVersion,
    expiresAt: row.expiresAt.toISOString(),
    confirmationRequired: true,
    executionToolExposedToModel: false,
  };
}

function terminalFailure(status: "EXPIRED" | "REJECTED" | "CONFLICT" | "FAILED", code: string, message: string) {
  return { kind: "failure" as const, status, code, message };
}

async function authorizedReplay(
  db: ActionDb,
  row: { status: string; proposalJson: Prisma.JsonValue; executionResultJson: Prisma.JsonValue | null },
  userId: string,
): Promise<ActionExecutionResult | null> {
  if (row.status !== "EXECUTED" || !row.executionResultJson) return null;
  const proposal = taskProposalDocumentSchema.safeParse(row.proposalJson);
  if (!proposal.success) throw new ApiError(409, "已执行动作缺少可校验的提议元数据");
  const task = await db.task.findUnique({
    where: { id: proposal.data.target.taskId },
    select: { projectId: true, assigneeId: true, createdBy: true },
  });
  if (!task || task.projectId !== proposal.data.target.projectId || !(await taskPermission(db, userId, task.projectId, task)).allowed) {
    throw new ApiError(403, "目标资源不存在或当前账号无权访问");
  }
  return { ...(row.executionResultJson as unknown as ActionExecutionResult), replayed: true };
}

export class PrismaActionService implements ToolActionProposalService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async proposeTaskUpdate(
    input: TaskUpdateProposalInput,
    context: ToolExecutionContext,
    user: SessionUser,
  ): Promise<{ proposal: TaskUpdateProposalRecord; permissionsApplied: string[] }> {
    const definition = actionDefinition("TASK_UPDATE_LOW_RISK");
    if (!definition || definition.status !== "enabled") throw new ApiError(503, "任务更新动作当前未启用");
    configuredActionApprovalSecret();
    const changes = normalizeChanges(input.changes);
    const normalizedInput = { taskId: input.taskId, changes, reason: input.reason?.trim() || null };
    const inputFingerprint = sha256(JSON.stringify(normalizedInput));
    const proposalKey = sha256(`agent-action-proposal:${user.id}:${context.runId}:${input.idempotencyKey}`);
    const existing = await this.db.agentApprovalRequest.findUnique({ where: { idempotencyKey: proposalKey } });
    if (existing) {
      if (existing.requestedById !== user.id || existing.runId !== context.runId || existing.proposalHash !== inputFingerprint) {
        throw new ApiError(409, "动作提议幂等键已用于不同内容");
      }
      return { proposal: proposalRecord(existing), permissionsApplied: ["idempotent_replay"] };
    }

    const [run, task] = await Promise.all([
      this.db.agentRun.findUnique({ where: { id: context.runId }, select: { userId: true, status: true, expiresAt: true } }),
      this.db.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          projectId: true,
          title: true,
          description: true,
          priority: true,
          dueDate: true,
          estimatedHours: true,
          assigneeId: true,
          createdBy: true,
          updatedAt: true,
        },
      }),
    ]);
    if (!run || run.userId !== user.id || run.status !== "RUNNING") throw new ApiError(409, "Agent Run 已不允许创建动作提议");
    if (!task) throw new ApiError(404, "目标资源不存在或当前账号无权访问");
    const permission = await taskPermission(this.db, user.id, task.projectId, task);
    if (!permission.allowed) throw new ApiError(403, "目标资源不存在或当前账号无权访问");
    const { before, after } = taskBeforeAfter(task, changes);
    const now = this.clock();
    const maxExpiry = new Date(now.getTime() + PROPOSAL_TTL_MS);
    const expiresAt = run.expiresAt && run.expiresAt < maxExpiry ? run.expiresAt : maxExpiry;
    if (expiresAt <= now) throw new ApiError(409, "Agent Run 已过期，无法创建动作提议");
    const proposalId = randomUUID();
    const proposalJson = {
      schemaVersion: "1.0" as const,
      actionType: "TASK_UPDATE_LOW_RISK" as const,
      target: { taskId: task.id, projectId: task.projectId, title: task.title },
      changes,
      before,
      after,
      reason: normalizedInput.reason,
      traceId: context.traceId,
      requestId: context.requestId,
      inputFingerprint,
    };
    const approvalNonceHash = sha256(randomBytes(32).toString("hex"));
    const executionIdempotencyKey = sha256(`agent-action-execution:${proposalId}`);
    try {
      const created = await this.db.agentApprovalRequest.create({
        data: {
          id: proposalId,
          runId: context.runId,
          requestedById: user.id,
          status: "PENDING",
          actionType: "TASK_UPDATE_LOW_RISK",
          riskLevel: "LOW",
          targetEntityType: "TASK",
          targetEntityId: task.id,
          expectedVersion: task.updatedAt.toISOString(),
          proposalJson,
          proposalHash: inputFingerprint,
          approvalNonceHash,
          idempotencyKey: proposalKey,
          executionIdempotencyKey,
          expiresAt,
        },
      });
      return { proposal: proposalRecord(created), permissionsApplied: permission.permissionsApplied };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await this.db.agentApprovalRequest.findUnique({ where: { idempotencyKey: proposalKey } });
        if (replay?.requestedById === user.id && replay.runId === context.runId && replay.proposalHash === inputFingerprint) {
          return { proposal: proposalRecord(replay), permissionsApplied: ["idempotent_replay"] };
        }
      }
      throw error;
    }
  }

  async listOwnedProposals(user: SessionUser, runId: string): Promise<ActionProposalView[]> {
    const run = await this.db.agentRun.findFirst({ where: { id: runId, userId: user.id }, select: { id: true } });
    if (!run) throw new ApiError(404, "Agent Run 不存在");
    const rows = await this.db.agentApprovalRequest.findMany({
      where: { runId, requestedById: user.id },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => this.toView(row, user.id));
  }

  private toView(row: ProposalViewRow, userId: string): ActionProposalView {
    const proposal = taskProposalDocumentSchema.parse(row.proposalJson);
    if (!row.expectedVersion) throw new ApiError(500, "动作提议缺少预期版本");
    const now = this.clock();
    const effectiveStatus = row.status === "PENDING" && row.expiresAt <= now ? "EXPIRED" : row.status;
    let approvalToken: string | null = null;
    if (effectiveStatus === "PENDING" && row.approvalNonceHash) {
      try {
        approvalToken = issueApprovalToken(
          {
            proposalId: row.id,
            userId,
            nonceHash: row.approvalNonceHash,
            expectedVersion: row.expectedVersion,
            expiresAt: row.expiresAt,
          },
          configuredActionApprovalSecret(),
          now,
        );
      } catch {
        approvalToken = null;
      }
    }
    return {
      id: row.id,
      runId: row.runId,
      status: effectiveStatus,
      actionType: row.actionType,
      riskLevel: row.riskLevel,
      target: proposal.target,
      before: proposal.before,
      after: proposal.after,
      reason: proposal.reason,
      expectedVersion: row.expectedVersion,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      canExecute: effectiveStatus === "PENDING" && approvalToken !== null,
      approvalToken,
      confirmationText: CONFIRMATION_TEXT,
      executionResult: row.executionResultJson,
      readback: row.readbackJson,
      failure: row.failureCode && row.failureMessage ? { code: row.failureCode, message: row.failureMessage } : null,
    };
  }

  async executeOwnedProposal(
    user: SessionUser,
    proposalId: string,
    rawInput: z.input<typeof executeActionInputSchema>,
  ): Promise<ActionExecutionResult> {
    const input = executeActionInputSchema.parse(rawInput);
    const initial = await this.db.agentApprovalRequest.findFirst({ where: { id: proposalId, requestedById: user.id } });
    if (!initial) throw new ApiError(404, "动作提议不存在");
    if (!initial.expectedVersion || !initial.approvalNonceHash) throw new ApiError(409, "动作提议缺少执行授权元数据");
    const token = verifyApprovalToken(input.approvalToken, configuredActionApprovalSecret(), this.clock());
    if (
      token.proposalId !== proposalId ||
      token.userId !== user.id ||
      token.nonceHash !== initial.approvalNonceHash ||
      token.expectedVersion !== initial.expectedVersion ||
      input.expectedVersion !== initial.expectedVersion
    ) {
      throw new ApiError(409, "确认授权与动作提议不匹配");
    }
    const initialReplay = await authorizedReplay(this.db, initial, user.id);
    if (initialReplay) return initialReplay;

    const outcome = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workbuddy:agent-action:${proposalId}`}))`;
      const row = await tx.agentApprovalRequest.findFirst({ where: { id: proposalId, requestedById: user.id } });
      if (!row) return terminalFailure("REJECTED", "PROPOSAL_NOT_FOUND", "动作提议不存在");
      const replay = await authorizedReplay(tx, row, user.id);
      if (replay) return { kind: "success" as const, result: replay };
      if (row.status !== "PENDING") return terminalFailure("REJECTED", "PROPOSAL_NOT_PENDING", `动作提议状态为 ${row.status}`);
      const now = this.clock();
      const proposal = taskProposalDocumentSchema.safeParse(row.proposalJson);
      if (!proposal.success || !row.expectedVersion || !row.executionIdempotencyKey) {
        await tx.agentApprovalRequest.update({
          where: { id: row.id },
          data: { status: "FAILED", failureCode: "INVALID_PROPOSAL", failureMessage: "动作提议结构不完整", decidedById: user.id, decidedAt: now },
        });
        return terminalFailure("FAILED", "INVALID_PROPOSAL", "动作提议结构不完整");
      }
      if (row.expiresAt <= now) {
        await tx.agentApprovalRequest.update({
          where: { id: row.id },
          data: { status: "EXPIRED", failureCode: "PROPOSAL_EXPIRED", failureMessage: "动作提议已过期", decidedById: user.id, decidedAt: now },
        });
        return terminalFailure("EXPIRED", "PROPOSAL_EXPIRED", "动作提议已过期");
      }
      const task = await tx.task.findUnique({
        where: { id: proposal.data.target.taskId },
        select: {
          id: true,
          projectId: true,
          title: true,
          description: true,
          priority: true,
          dueDate: true,
          estimatedHours: true,
          assigneeId: true,
          createdBy: true,
          updatedAt: true,
        },
      });
      if (!task || task.projectId !== proposal.data.target.projectId) {
        await tx.agentApprovalRequest.update({
          where: { id: row.id },
          data: { status: "REJECTED", failureCode: "TARGET_NOT_ACCESSIBLE", failureMessage: "目标资源不存在或当前账号无权访问", decidedById: user.id, decidedAt: now },
        });
        return terminalFailure("REJECTED", "TARGET_NOT_ACCESSIBLE", "目标资源不存在或当前账号无权访问");
      }
      const permission = await taskPermission(tx, user.id, task.projectId, task);
      if (!permission.allowed) {
        await tx.agentApprovalRequest.update({
          where: { id: row.id },
          data: { status: "REJECTED", failureCode: "PERMISSION_REVOKED", failureMessage: "执行前权限复核失败", decidedById: user.id, decidedAt: now },
        });
        return terminalFailure("REJECTED", "PERMISSION_REVOKED", "执行前权限复核失败");
      }
      if (task.updatedAt.toISOString() !== row.expectedVersion) {
        await tx.agentApprovalRequest.update({
          where: { id: row.id },
          data: { status: "CONFLICT", failureCode: "EXPECTED_VERSION_MISMATCH", failureMessage: "目标任务已被其他操作更新", decidedById: user.id, decidedAt: now },
        });
        return terminalFailure("CONFLICT", "EXPECTED_VERSION_MISMATCH", "目标任务已被其他操作更新，请重新生成提议");
      }
      const updatedCount = await tx.task.updateMany({
        where: { id: task.id, updatedAt: new Date(row.expectedVersion) },
        data: taskPatch(proposal.data.changes),
      });
      if (updatedCount.count !== 1) {
        await tx.agentApprovalRequest.update({
          where: { id: row.id },
          data: { status: "CONFLICT", failureCode: "EXPECTED_VERSION_MISMATCH", failureMessage: "目标任务已被并发更新", decidedById: user.id, decidedAt: now },
        });
        return terminalFailure("CONFLICT", "EXPECTED_VERSION_MISMATCH", "目标任务已被并发更新，请重新生成提议");
      }
      const readback = await tx.task.findUniqueOrThrow({
        where: { id: task.id },
        select: { id: true, projectId: true, title: true, description: true, priority: true, dueDate: true, estimatedHours: true, updatedAt: true },
      });
      const serializedReadback = {
        ...readback,
        dueDate: readback.dueDate?.toISOString().slice(0, 10) ?? null,
        updatedAt: readback.updatedAt.toISOString(),
      };
      const result: ActionExecutionResult = {
        proposalId: row.id,
        status: "EXECUTED",
        executionIdempotencyKey: row.executionIdempotencyKey,
        readback: serializedReadback,
        auditCorrelationId: row.id,
        replayed: false,
      };
      await writeAudit(
        {
          userId: user.id,
          projectId: task.projectId,
          correlationId: row.id,
          eventType: "agent.action.executed",
          action: "UPDATE",
          entityType: "TASK",
          entityId: task.id,
          diff: { before: proposal.data.before, after: proposal.data.after },
          metadata: {
            agentRunId: row.runId,
            approvalRequestId: row.id,
            actionType: row.actionType,
            riskLevel: row.riskLevel,
            executionIdempotencyKey: row.executionIdempotencyKey,
            permissionsApplied: permission.permissionsApplied,
            sourceToolRequestId: proposal.data.requestId,
          },
        },
        tx,
      );
      await writeActivityEvent(tx, {
        projectId: task.projectId,
        actorUserId: user.id,
        eventType: "task.agent_updated",
        entityType: "TASK",
        entityId: task.id,
        correlationId: row.id,
        payload: { title: task.title, changedFields: Object.keys(proposal.data.after) },
        occurredAt: now,
      });
      await tx.agentApprovalRequest.update({
        where: { id: row.id },
        data: {
          status: "EXECUTED",
          decidedById: user.id,
          decidedAt: now,
          executedAt: now,
          executionResultJson: result as unknown as Prisma.InputJsonValue,
          readbackJson: serializedReadback as unknown as Prisma.InputJsonValue,
          failureCode: null,
          failureMessage: null,
        },
      });
      return { kind: "success" as const, result };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(async (error: unknown) => {
      // PostgreSQL Serializable 下，并发重放可能让后进入的事务拿到旧快照并以 P2034 终止。
      // 业务事务已经由另一请求提交时，仅回放持久化结果，绝不再次执行写入。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        const replay = await this.db.agentApprovalRequest.findFirst({ where: { id: proposalId, requestedById: user.id } });
        if (replay) {
          const authorized = await authorizedReplay(this.db, replay, user.id);
          if (authorized) return { kind: "success" as const, result: authorized };
        }
      }
      throw error;
    });

    if (outcome.kind === "failure") {
      const status = outcome.status === "CONFLICT" || outcome.status === "EXPIRED" ? 409 : outcome.status === "REJECTED" ? 403 : 500;
      throw new ApiError(status, outcome.message);
    }
    try {
      await indexEntity({
        entityType: "TASK",
        entityId: outcome.result.readback.id,
        projectId: outcome.result.readback.projectId,
        title: outcome.result.readback.title,
        body: outcome.result.readback.description,
      });
    } catch (error: unknown) {
      console.error(`[agent-action] 派生搜索索引更新失败 proposal=${proposalId}`, error instanceof Error ? error.name : typeof error);
    }
    return outcome.result;
  }

  async cancelOwnedProposal(user: SessionUser, proposalId: string): Promise<ActionProposalView> {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workbuddy:agent-action:${proposalId}`}))`;
      const row = await tx.agentApprovalRequest.findFirst({ where: { id: proposalId, requestedById: user.id } });
      if (!row) throw new ApiError(404, "动作提议不存在");
      if (row.status === "CANCELLED") return;
      if (row.status !== "PENDING") throw new ApiError(409, `动作提议状态为 ${row.status}，不能取消`);
      const now = this.clock();
      await tx.agentApprovalRequest.update({
        where: { id: row.id },
        data: {
          status: row.expiresAt <= now ? "EXPIRED" : "CANCELLED",
          decidedById: user.id,
          decidedAt: now,
          failureCode: row.expiresAt <= now ? "PROPOSAL_EXPIRED" : "USER_CANCELLED",
          failureMessage: row.expiresAt <= now ? "动作提议已过期" : "用户取消动作提议",
        },
      });
      await writeAudit({
        userId: user.id,
        correlationId: row.id,
        eventType: "agent.action.cancelled",
        action: "CANCEL",
        entityType: "AGENT_ACTION",
        entityId: row.id,
        metadata: { agentRunId: row.runId, actionType: row.actionType },
      }, tx);
    });
    const updated = await this.db.agentApprovalRequest.findFirstOrThrow({ where: { id: proposalId, requestedById: user.id } });
    return this.toView(updated, user.id);
  }
}

export const prismaActionService = new PrismaActionService();
