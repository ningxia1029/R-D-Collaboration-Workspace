import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { AgentRunner } from "../agent-worker/src/runner";
import { ScriptedProvider } from "../agent-worker/src/provider";
import type { RunClaim, RuntimeToolClient, ToolDefinition } from "../agent-worker/src/protocol";
import { WorkerProcessInterrupted } from "../agent-worker/src/errors";
import { PrismaAgentRuntimeControlPlane } from "../src/lib/agent/runtime/prismaControlPlane";

const prisma = new PrismaClient({ errorFormat: "minimal" });
const DELEGATION_SECRET = "phase-3-db-acceptance-delegation-secret-32-bytes";
const SUMMARY_TOOL: ToolDefinition = {
  name: "plm_project_get_summary",
  description: "阶段 3 数据库验收只读 Tool",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  sideEffect: "none",
  timeoutMs: 2_000,
};
const PROJECT_RESOLVE_TOOL: ToolDefinition = {
  name: "plm_project_resolve",
  description: "阶段 3 数据库验收项目解析 Tool",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  sideEffect: "none",
  timeoutMs: 2_000,
};

function requireIsolatedTarget(): { databaseName: string; host: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL；拒绝猜测阶段 3 验收库");
  const parsedUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  if (!/^(postgresql|postgres):$/.test(parsedUrl.protocol)) throw new Error("DATABASE_URL 必须是 PostgreSQL 连接串");
  if (process.env.AGENT_RUNTIME_VERIFY_TARGET_ACK !== databaseName) {
    throw new Error("AGENT_RUNTIME_VERIFY_TARGET_ACK 必须与 DATABASE_URL 中的数据库名完全一致");
  }
  if (process.env.AGENT_RUNTIME_VERIFY_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error("仅允许可丢弃隔离库；必须显式设置 AGENT_RUNTIME_VERIFY_ALLOW_DESTRUCTIVE=1");
  }
  return { databaseName, host: parsedUrl.hostname };
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class IdempotentToolClient implements RuntimeToolClient {
  readonly calls = new Map<string, unknown>();
  invokeAttempts = 0;

  async listTools(): Promise<ToolDefinition[]> {
    return [PROJECT_RESOLVE_TOOL, SUMMARY_TOOL];
  }

  async invoke(input: { requestId: string; tool: string }): Promise<unknown> {
    this.invokeAttempts += 1;
    if (!this.calls.has(input.requestId)) {
      const output = {
        ok: true,
        tool: input.tool,
        data:
          input.tool === PROJECT_RESOLVE_TOOL.name
            ? { resolution: "not_found", candidates: [] }
            : { blockedTaskCount: 2 },
        evidence: [{ evidenceId: "aggregate:phase3" }],
        asOf: "2026-08-12T06:00:00.000Z",
      };
      const separator = input.requestId.indexOf(":");
      assertCondition(separator > 0, "Tool requestId 缺少 Run 前缀");
      const runId = input.requestId.slice(0, separator);
      await prisma.agentToolExecution.upsert({
        where: { requestId: input.requestId },
        update: {},
        create: {
          runId,
          requestId: input.requestId,
          toolName: input.tool,
          status: "SUCCEEDED",
          inputHash: "phase3-acceptance-no-raw-input",
          inputSummaryJson: { rawInputStored: false },
          outputSummaryJson: { evidenceCount: 1 },
          evidenceJson: { evidenceIds: ["aggregate:phase3"] },
          projectIdsJson: [],
          durationMs: 1,
          completedAt: new Date(),
        },
      });
      this.calls.set(input.requestId, output);
    }
    return this.calls.get(input.requestId);
  }
}

async function businessSnapshot(): Promise<string> {
  const [roles, users, projects, tasks, documents, changes, boms, activities, outbox, auditLogs] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: "asc" } }),
    prisma.user.findMany({ orderBy: { id: "asc" } }),
    prisma.project.findMany({ orderBy: { id: "asc" } }),
    prisma.task.findMany({ orderBy: { id: "asc" } }),
    prisma.document.findMany({ orderBy: { id: "asc" } }),
    prisma.changeLog.findMany({ orderBy: { id: "asc" } }),
    prisma.bomItem.findMany({ orderBy: { id: "asc" } }),
    prisma.activityEvent.findMany({ orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ orderBy: { id: "asc" } }),
    prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ roles, users, projects, tasks, documents, changes, boms, activities, outbox, auditLogs });
}

async function createRun(userId: string, suffix: string, kind: string, scopeJson: Prisma.InputJsonValue = {}): Promise<string> {
  const scope = scopeJson && typeof scopeJson === "object" && !Array.isArray(scopeJson) ? scopeJson : {};
  const run = await prisma.agentRun.create({
    data: {
      id: `phase3-run-${kind}-${suffix}`,
      userId,
      sessionId: `phase3-session-${kind}`,
      promptVersion: "plm-agent-system@1.0.0",
      scopeJson: { traceId: `phase3-trace-${kind}`, ...scope } as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      messages: {
        create: { sequence: 0, role: "user", content: `${kind} 阶段 3 验收问题` },
      },
    },
  });
  return run.id;
}

async function main(): Promise<void> {
  const target = requireIsolatedTarget();
  const suffix = randomUUID().replace(/-/g, "");
  const roleId = `phase3-role-${suffix}`;
  const userId = `phase3-user-${suffix}`;
  const createdRunIds: string[] = [];
  console.log(`[agent-runtime-db] 已确认隔离目标 ${target.host}/${target.databaseName}`);
  try {
    await prisma.role.create({ data: { id: roleId, name: `phase3-viewer-${suffix}`, description: "阶段 3 验收" } });
    await prisma.user.create({
      data: {
        id: userId,
        email: `phase3-${suffix}@invalid.local`,
        name: "阶段 3 验收用户",
        passwordHash: "acceptance-only",
        roleId,
      },
    });
    const beforeBusiness = await businessSnapshot();
    const control = new PrismaAgentRuntimeControlPlane({ db: prisma, delegationSecret: DELEGATION_SECRET });
    const tools = new IdempotentToolClient();

    const recoverRunId = await createRun(userId, suffix, "recover");
    createdRunIds.push(recoverRunId);
    const firstClaim = await control.claimNext("phase3-worker-a", 5_000);
    assertCondition(firstClaim?.lease.runId === recoverRunId, `Worker A 未领取预期恢复 Run：expected=${recoverRunId} actual=${firstClaim?.lease.runId ?? "null"}`);
    const sameTimeClaim = await control.claimNext("phase3-worker-b", 5_000);
    assertCondition(sameTimeClaim === null, "有效租约期间同一 Run 不得被并发领取");
    let interrupted = false;
    const firstRunner = new AgentRunner(
      control,
      tools,
      new ScriptedProvider([
        { kind: "tool_call", callId: "db-recovery", toolName: SUMMARY_TOOL.name, input: {} },
        { kind: "answer", answer: "第一次进程不应完成" },
      ]),
      {
        workerId: "phase3-worker-a",
        leaseMs: 5_000,
        pollCancellationMs: 25,
        hooks: {
          afterCheckpoint(checkpoint) {
            if (!interrupted && checkpoint.state.lastNode === "tool") {
              interrupted = true;
              throw new WorkerProcessInterrupted("模拟 Worker 崩溃");
            }
          },
        },
      },
    );
    await firstRunner.execute(firstClaim).then(
      () => {
        throw new Error("模拟 Worker 崩溃未向上传播");
      },
      (error: unknown) => {
        assertCondition(error instanceof WorkerProcessInterrupted, "中断类型不正确");
      },
    );
    const running = await prisma.agentRun.findUniqueOrThrow({ where: { id: recoverRunId } });
    assertCondition(running.status === "RUNNING", "突然退出时不得伪造终态");
    await prisma.agentRun.update({ where: { id: recoverRunId }, data: { leaseExpiresAt: new Date(Date.now() - 60_000) } });
    const recoveredClaim = await control.claimNext("phase3-worker-b", 5_000);
    assertCondition(recoveredClaim?.lease.runId === recoverRunId, "租约过期后 Worker B 未接管 Run");
    assertCondition(recoveredClaim.lease.version === 2, "接管后租约版本应递增");
    const recovered = await new AgentRunner(
      control,
      tools,
      new ScriptedProvider([{ kind: "answer", answer: "数据库检查点恢复成功。" }]),
      { workerId: "phase3-worker-b", leaseMs: 5_000, pollCancellationMs: 25 },
    ).execute(recoveredClaim);
    assertCondition(recovered.status === "SUCCEEDED", "恢复 Run 未成功完成");
    assertCondition(tools.calls.size === 1 && tools.invokeAttempts === 1, "恢复后重复执行了 Tool");

    const cancelRunId = await createRun(userId, suffix, "cancel");
    createdRunIds.push(cancelRunId);
    const cancelClaim = await control.claimNext("phase3-worker-cancel", 5_000);
    assertCondition(cancelClaim?.lease.runId === cancelRunId, "未领取取消 Run");
    await prisma.agentRun.update({ where: { id: cancelRunId }, data: { cancelRequestedAt: new Date() } });
    const cancelled = await new AgentRunner(
      control,
      tools,
      new ScriptedProvider([{ kind: "answer", answer: "不应执行" }]),
      { workerId: "phase3-worker-cancel", leaseMs: 5_000, pollCancellationMs: 25 },
    ).execute(cancelClaim);
    assertCondition(cancelled.status === "CANCELLED", "取消 Run 未进入 CANCELLED");

    const waitingRunId = await createRun(userId, suffix, "clarify");
    createdRunIds.push(waitingRunId);
    const waitingClaim = await control.claimNext("phase3-worker-wait", 5_000);
    assertCondition(waitingClaim?.lease.runId === waitingRunId, "未领取消歧 Run");
    const waiting = await new AgentRunner(
      control,
      tools,
      new ScriptedProvider([{ kind: "clarify", question: "请确认具体项目编号。" }]),
      { workerId: "phase3-worker-wait", leaseMs: 5_000, pollCancellationMs: 25 },
    ).execute(waitingClaim);
    assertCondition(waiting.status === "WAITING_FOR_USER", "消歧 Run 未进入等待状态");

    const unresolvedRunId = await createRun(userId, suffix, "unresolved-project");
    createdRunIds.push(unresolvedRunId);
    const unresolvedClaim = await control.claimNext("phase3-worker-unresolved", 5_000);
    assertCondition(unresolvedClaim?.lease.runId === unresolvedRunId, "未领取项目解析失败 Run");
    const unresolved = await new AgentRunner(
      control,
      tools,
      new ScriptedProvider([
        {
          kind: "tool_call",
          callId: "db-project-resolve-not-found",
          toolName: PROJECT_RESOLVE_TOOL.name,
          input: { query: "不存在的项目", limit: 5 },
        },
        {
          kind: "tool_call",
          callId: "db-summary-must-not-run",
          toolName: SUMMARY_TOOL.name,
          input: { projectId: "invented-project" },
        },
      ]),
      { workerId: "phase3-worker-unresolved", leaseMs: 5_000, pollCancellationMs: 25 },
    ).execute(unresolvedClaim);
    assertCondition(unresolved.status === "WAITING_FOR_USER", "项目解析 not_found 未进入等待状态");
    assertCondition(
      unresolved.state?.clarification?.includes("未找到唯一可见项目"),
      "项目解析 not_found 未产生确定性澄清问题",
    );
    const unresolvedAudits = await prisma.agentToolExecution.findMany({
      where: { runId: unresolvedRunId },
      select: { toolName: true },
    });
    assertCondition(
      unresolvedAudits.length === 1 && unresolvedAudits[0]?.toolName === PROJECT_RESOLVE_TOOL.name,
      "项目解析失败后仍执行了项目业务 Tool",
    );

    const runRows = await prisma.agentRun.findMany({ where: { id: { in: createdRunIds } }, orderBy: { id: "asc" } });
    const statuses = new Set(runRows.map((row) => row.status));
    assertCondition(statuses.has("SUCCEEDED") && statuses.has("CANCELLED") && statuses.has("WAITING_FOR_USER"), "缺少预期终态");
    assertCondition(runRows.every((row) => row.leaseOwnerId === null && row.leaseExpiresAt === null), "终态/等待态仍残留租约");
    const checkpoints = await prisma.agentCheckpoint.count({ where: { runId: recoverRunId, checkpointNs: "runtime-v1" } });
    const events = await prisma.agentRunEvent.count({ where: { runId: { in: createdRunIds } } });
    assertCondition(checkpoints >= 3, "恢复 Run 检查点数量不足");
    assertCondition(events >= 6, "Run 事件数量不足");
    const duplicateRequestIds = await prisma.$queryRaw<Array<{ request_id: string; count: bigint }>>(Prisma.sql`
      SELECT "request_id", COUNT(*) AS count
      FROM "Agent_Tool_Executions"
      WHERE "run_id" IN (${Prisma.join(createdRunIds)})
      GROUP BY "request_id"
      HAVING COUNT(*) > 1
    `);
    assertCondition(duplicateRequestIds.length === 0, "Tool 审计出现重复 requestId");
    const toolAuditCount = await prisma.agentToolExecution.count({ where: { runId: recoverRunId } });
    assertCondition(toolAuditCount === 1, "恢复 Run 应且仅应有 1 条 Tool 审计");
    const afterBusiness = await businessSnapshot();
    assertCondition(beforeBusiness === afterBusiness, "Agent Runtime 修改了业务表");

    console.log("[agent-runtime-db] PASS 租约互斥与过期接管");
    console.log("[agent-runtime-db] PASS Worker 崩溃后检查点恢复，Tool 仅执行 1 次");
    console.log(`[agent-runtime-db] PASS Tool 审计 requestId 唯一，records=${toolAuditCount}`);
    console.log("[agent-runtime-db] PASS SUCCEEDED/CANCELLED/WAITING_FOR_USER 确定终态");
    console.log("[agent-runtime-db] PASS 项目解析 not_found 后强制澄清，后续项目 Tool 0 次");
    console.log(`[agent-runtime-db] PASS checkpoints=${checkpoints} events=${events}`);
    console.log("[agent-runtime-db] PASS 业务表前后快照一致");
  } finally {
    if (createdRunIds.length > 0) await prisma.agentRun.deleteMany({ where: { id: { in: createdRunIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[agent-runtime-db] FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
