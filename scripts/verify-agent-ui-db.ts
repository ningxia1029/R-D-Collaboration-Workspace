import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { applyAgentControlPolicy, getAgentControlSnapshot } from "../src/lib/agent/control";
import {
  cancelOwnedAgentRun,
  createAgentRun,
  getOwnedAgentRun,
  resumeOwnedAgentRun,
  retryOwnedAgentRun,
} from "../src/lib/agent/runs";
import { ApiError, type SessionUser } from "../src/lib/rbac";
import type { PortableRuntimeState } from "../agent-worker/src/protocol";

const prisma = new PrismaClient({ errorFormat: "minimal" });
const SECRET = "phase-four-isolated-acceptance-secret-32-bytes";
process.env.AGENT_INTERNAL_SERVICE_SECRET = SECRET;
process.env.AGENT_DELEGATION_SECRET = SECRET;
process.env.AGENT_CURSOR_SECRET = SECRET;

function requireIsolatedTarget(): { databaseName: string; host: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL；拒绝猜测阶段 4 验收库");
  const parsedUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  if (!/^(postgresql|postgres):$/.test(parsedUrl.protocol)) throw new Error("DATABASE_URL 必须是 PostgreSQL 连接串");
  if (process.env.AGENT_UI_VERIFY_TARGET_ACK !== databaseName) {
    throw new Error("AGENT_UI_VERIFY_TARGET_ACK 必须与 DATABASE_URL 中的数据库名完全一致");
  }
  if (process.env.AGENT_UI_VERIFY_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error("仅允许可丢弃隔离库；必须显式设置 AGENT_UI_VERIFY_ALLOW_DESTRUCTIVE=1");
  }
  return { databaseName, host: parsedUrl.hostname };
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stateFor(runId: string, projectId?: string): PortableRuntimeState {
  return {
    schemaVersion: "1.0",
    runId,
    traceId: `trace-${runId}`,
    question: "阶段 4 消歧问题",
    phase: "WAITING_FOR_USER",
    stepCount: 1,
    toolCallCount: 1,
    inputTokenCount: 10,
    outputTokenCount: 5,
    estimatedCostMicros: 0,
    resultBytes: 256,
    eventSequence: 2,
    toolResults: [
      {
        callId: "summary",
        requestId: `${runId}:summary:0`,
        tool: "plm_project_get_summary",
        bytes: 256,
        output: {
          ok: true,
          contractVersion: "1.0",
          tool: "plm_project_get_summary",
          requestId: `${runId}:summary:0`,
          traceId: `trace-${runId}`,
          data: { privateRawValue: "不得进入前台 DTO" },
          evidence: [
            {
              evidenceId: `project:${projectId ?? "global"}:summary`,
              kind: "aggregate",
              entityType: "PROJECT",
              ...(projectId ? { entityId: projectId, projectId } : {}),
              label: "阶段 4 可追溯项目汇总",
              ...(projectId ? { uri: `/projects/${projectId}/tasks` } : {}),
              version: { type: "snapshot", value: "2026-08-12T06:00:00.000Z" },
            },
          ],
          asOf: "2026-08-12T06:00:00.000Z",
          scope: { projectIds: projectId ? [projectId] : [], permissionsApplied: ["project:read"], redactions: ["email"] },
          warnings: [{ code: "FIXED_ACCEPTANCE", message: "阶段 4 固定验收数据" }],
        },
      },
    ],
    clarification: "请补充具体范围。",
    lastNode: "wait",
  };
}

async function main(): Promise<void> {
  const target = requireIsolatedTarget();
  const suffix = randomUUID().replace(/-/g, "");
  const roleId = `phase4-role-${suffix}`;
  const adminId = `phase4-admin-${suffix}`;
  const engineerId = `phase4-engineer-${suffix}`;
  const outsiderId = `phase4-outsider-${suffix}`;
  const projectId = `phase4-project-${suffix}`;
  const runIds: string[] = [];
  const admin: SessionUser = { id: adminId, email: `${adminId}@invalid.local`, name: "阶段 4 管理员", roleId, roleName: "admin" };
  const engineer: SessionUser = { id: engineerId, email: `${engineerId}@invalid.local`, name: "阶段 4 工程师", roleId, roleName: "engineer" };
  const outsider: SessionUser = { id: outsiderId, email: `${outsiderId}@invalid.local`, name: "阶段 4 外部用户", roleId, roleName: "engineer" };
  console.log(`[agent-ui-db] 已确认隔离目标 ${target.host}/${target.databaseName}`);

  try {
    await prisma.role.create({ data: { id: roleId, name: `phase4-role-${suffix}`, description: "阶段 4 验收" } });
    await prisma.user.createMany({
      data: [admin, engineer, outsider].map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        passwordHash: "acceptance-only",
        roleId,
      })),
    });
    await prisma.project.create({ data: { id: projectId, code: `P4-${suffix.slice(0, 8)}`, name: "阶段 4 隔离项目", ownerId: adminId } });
    await prisma.projectMember.create({ data: { projectId, userId: engineerId } });

    const closedByDefault = await getAgentControlSnapshot(prisma);
    assertCondition(!closedByDefault.enabled && !closedByDefault.operational, "无控制行时必须默认关闭");
    const enabled = await applyAgentControlPolicy(
      {
        enabled: true,
        disabledTools: ["plm_document_search"],
        maintenanceMessage: null,
        updatedById: adminId,
      },
      prisma,
    );
    assertCondition(enabled.operational, "配置完整且管理员启用后应可运行");
    assertCondition(enabled.disabledTools[0] === "plm_document_search", "Tool 停用策略未持久化");

    const first = await createAgentRun(
      admin,
      { question: "阶段 4 幂等创建问题", idempotencyKey: `phase4-${suffix}-first` },
      prisma,
    );
    runIds.push(first.id);
    const duplicate = await createAgentRun(
      admin,
      { question: "阶段 4 幂等创建问题", idempotencyKey: `phase4-${suffix}-first` },
      prisma,
    );
    assertCondition(duplicate.id === first.id, "相同幂等键产生了重复 Run");
    const firstMessages = await prisma.agentMessage.count({ where: { runId: first.id } });
    const firstEvents = await prisma.agentRunEvent.count({ where: { runId: first.id } });
    assertCondition(firstMessages === 1 && firstEvents === 1, "创建 Run 未原子写入消息和初始事件");
    assertCondition(Boolean(first.expiresAt && first.retentionUntil), "Run 缺少超时或保留期限");

    const ownerDetail = await getOwnedAgentRun(admin, first.id, prisma);
    assertCondition(ownerDetail.id === first.id, "Run 所有者无法读取详情");
    await getOwnedAgentRun(outsider, first.id, prisma).then(
      () => { throw new Error("其他用户读取了不属于自己的 Run"); },
      (error: unknown) => assertCondition(error instanceof ApiError && error.status === 404, "越权读取未统一隐藏资源存在性"),
    );
    const cancelled = await cancelOwnedAgentRun(admin.id, first.id, prisma);
    assertCondition(cancelled.status === "CANCELLED" && cancelled.completedAt, "排队 Run 未确定性取消");

    const waiting = await createAgentRun(admin, { question: "需要消歧的问题" }, prisma);
    runIds.push(waiting.id);
    const waitingState = stateFor(waiting.id);
    await prisma.$transaction([
      prisma.agentRun.update({ where: { id: waiting.id }, data: { status: "WAITING_FOR_USER", currentNode: "wait" } }),
      prisma.agentCheckpoint.create({
        data: {
          runId: waiting.id,
          checkpointNs: "runtime-v1",
          checkpointId: "phase4-wait",
          stateJson: waitingState as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    const waitingDetail = await getOwnedAgentRun(admin, waiting.id, prisma);
    assertCondition(waitingDetail.clarification === "请补充具体范围。", "前台未呈现结构化消歧问题");
    assertCondition(waitingDetail.toolResults[0]?.evidence.length === 1, "前台未呈现证据引用");
    assertCondition(!JSON.stringify(waitingDetail.toolResults).includes("不得进入前台 DTO"), "Presenter 泄露了原始 Tool data");
    const resumed = await resumeOwnedAgentRun(admin.id, waiting.id, "项目编号为 P4。", prisma);
    assertCondition(resumed.status === "QUEUED" && resumed.currentNode === "user_resume", "消歧恢复未重新入队");
    const resumedCheckpoint = await prisma.agentCheckpoint.findFirstOrThrow({
      where: { runId: waiting.id },
      orderBy: { createdAt: "desc" },
    });
    assertCondition(resumedCheckpoint.parentCheckpointId === "phase4-wait", "恢复检查点未保留父链");

    await prisma.agentRun.update({ where: { id: waiting.id }, data: { status: "SUCCEEDED", completedAt: new Date() } });
    const retried = await retryOwnedAgentRun(admin, waiting.id, prisma);
    runIds.push(retried.id);
    assertCondition(retried.id !== waiting.id && retried.sessionId === waiting.sessionId, "安全重试未创建同会话的新 Run");

    const scoped = await createAgentRun(engineer, { question: "项目范围证据", projectId }, prisma);
    runIds.push(scoped.id);
    await prisma.agentCheckpoint.create({
      data: {
        runId: scoped.id,
        checkpointNs: "runtime-v1",
        checkpointId: "phase4-scoped",
        stateJson: stateFor(scoped.id, projectId) as unknown as Prisma.InputJsonValue,
      },
    });
    assertCondition((await getOwnedAgentRun(engineer, scoped.id, prisma)).id === scoped.id, "项目成员无法读取自己的 Run");
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId: engineerId } } });
    await getOwnedAgentRun(engineer, scoped.id, prisma).then(
      () => { throw new Error("项目权限撤销后仍能读取历史 Agent 结果"); },
      (error: unknown) => assertCondition(error instanceof ApiError && error.status === 404, "权限撤销后未 fail closed"),
    );

    const queuedForKill = await createAgentRun(admin, { question: "总开关取消排队 Run" }, prisma);
    const runningForKill = await createAgentRun(admin, { question: "总开关请求取消运行 Run" }, prisma);
    runIds.push(queuedForKill.id, runningForKill.id);
    await prisma.agentRun.update({
      where: { id: runningForKill.id },
      data: {
        status: "RUNNING",
        leaseOwnerId: "phase4-worker",
        leaseExpiresAt: new Date(Date.now() + 30_000),
        heartbeatAt: new Date(),
        leaseVersion: 1,
      },
    });
    const disabled = await applyAgentControlPolicy(
      {
        enabled: false,
        disabledTools: [],
        maintenanceMessage: "阶段 4 验收停用",
        updatedById: adminId,
      },
      prisma,
    );
    const [killedQueued, killedRunning] = await Promise.all([
      prisma.agentRun.findUniqueOrThrow({ where: { id: queuedForKill.id } }),
      prisma.agentRun.findUniqueOrThrow({ where: { id: runningForKill.id } }),
    ]);
    assertCondition(!disabled.operational, "总开关关闭后仍报告可运行");
    assertCondition(killedQueued.status === "CANCELLED" && killedQueued.currentNode === "admin_kill_switch", "总开关未取消排队 Run");
    assertCondition(killedRunning.status === "RUNNING" && killedRunning.cancelRequestedAt, "总开关未请求运行中 Run 取消");
    const controlAudits = await prisma.auditLog.count({ where: { entityType: "AGENT_CONTROL", entityId: "default" } });
    const killEvents = await prisma.agentRunEvent.count({
      where: { runId: queuedForKill.id, eventType: "RUN_CANCELLED" },
    });
    assertCondition(controlAudits === 2, "启用和停用控制动作未各写一条审计");
    assertCondition(killEvents === 1, "总开关取消排队 Run 后缺少确定性终态事件");

    console.log("[agent-ui-db] PASS 默认关闭、显式启用和 Tool 停用策略");
    console.log("[agent-ui-db] PASS 创建幂等、所有权隔离、取消、消歧恢复和安全重试");
    console.log("[agent-ui-db] PASS Presenter 不下发原始 Tool data，证据/时间/裁剪可见");
    console.log("[agent-ui-db] PASS 项目成员权限撤销后历史结果 fail closed");
    console.log("[agent-ui-db] PASS 总开关取消排队 Run、请求运行 Run 取消并写审计");
  } finally {
    await prisma.agentControlSetting.deleteMany({ where: { id: "default" } });
    await prisma.agentRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "AGENT_CONTROL", userId: adminId } });
    await prisma.projectMember.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, engineerId, outsiderId] } } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[agent-ui-db] FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
