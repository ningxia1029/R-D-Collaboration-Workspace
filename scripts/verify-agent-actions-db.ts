import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaActionService } from "../src/lib/agent/actions/service";
import { ACTION_DEFINITIONS } from "../src/lib/agent/actions/registry";
import type { ToolExecutionContext } from "../src/lib/agent/tools/contracts";
import { createProductionToolGateway } from "../src/lib/agent/tools/production";
import { ApiError, type SessionUser } from "../src/lib/rbac";

const prisma = new PrismaClient({ errorFormat: "minimal" });
const ACTION_SECRET = "phase-seven-isolated-action-approval-secret-32-bytes";
process.env.AGENT_ACTION_APPROVAL_SECRET = ACTION_SECRET;

function requireIsolatedTarget(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL；拒绝猜测阶段 7 验收库");
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^(postgresql|postgres):$/.test(parsed.protocol) || parsed.hostname !== "127.0.0.1") {
    throw new Error("阶段 7 验收只允许 127.0.0.1 PostgreSQL 隔离库");
  }
  if (process.env.AGENT_ACTION_VERIFY_TARGET_ACK !== databaseName) throw new Error("AGENT_ACTION_VERIFY_TARGET_ACK 必须与数据库名完全一致");
  if (process.env.AGENT_ACTION_VERIFY_ALLOW_DESTRUCTIVE !== "1") throw new Error("必须显式确认可丢弃隔离库");
  if (!/^workbuddy_phase7_[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error("数据库名不符合阶段 7 隔离命名规则");
  return databaseName;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectApiError(action: () => Promise<unknown>, status: number, label: string): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === status) return;
    if (status === 400 && error instanceof Error && error.name === "ZodError") return;
    throw new Error(`${label} 返回了非预期错误：${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} 未按预期失败`);
}

async function taskSnapshot(taskId: string): Promise<string> {
  const row = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { id: true, description: true, priority: true, dueDate: true, estimatedHours: true, updatedAt: true },
  });
  return JSON.stringify(row);
}

async function main() {
  const databaseName = requireIsolatedTarget();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const id = (name: string) => `p7-${name}-${suffix}`;
  const roles = { admin: id("role-admin"), pm: id("role-pm"), engineer: id("role-engineer"), viewer: id("role-viewer") };
  const users = { admin: id("user-admin"), pm: id("user-pm"), engineer: id("user-engineer"), other: id("user-other") };
  const projectId = id("project");
  const tasks = {
    success: id("task-success"),
    conflict: id("task-conflict"),
    permission: id("task-permission"),
    expired: id("task-expired"),
    cancelled: id("task-cancelled"),
  };
  const runs = { engineer: id("run-engineer"), pm: id("run-pm"), other: id("run-other") };
  let now = new Date();
  const clock = () => new Date(now);

  const engineer: SessionUser = { id: users.engineer, email: `${users.engineer}@invalid.local`, name: "阶段 7 工程师", roleId: roles.engineer, roleName: "engineer" };
  const pm: SessionUser = { id: users.pm, email: `${users.pm}@invalid.local`, name: "阶段 7 项目经理", roleId: roles.pm, roleName: "pm" };
  const other: SessionUser = { id: users.other, email: `${users.other}@invalid.local`, name: "阶段 7 其他用户", roleId: roles.pm, roleName: "pm" };

  try {
    const version = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    console.log(`[agent-action-db] target=${databaseName} engine=${version[0]?.version.split(",")[0] ?? "unknown"}`);
    await prisma.role.createMany({ data: [
      { id: roles.admin, name: "admin", description: "阶段 7 管理员" },
      { id: roles.pm, name: "pm", description: "阶段 7 项目经理" },
      { id: roles.engineer, name: "engineer", description: "阶段 7 工程师" },
      { id: roles.viewer, name: "viewer", description: "阶段 7 只读" },
    ] });
    await prisma.user.createMany({ data: [
      { id: users.admin, email: `${users.admin}@invalid.local`, name: "阶段 7 管理员", passwordHash: "acceptance-only", roleId: roles.admin },
      { id: users.pm, email: pm.email, name: pm.name, passwordHash: "acceptance-only", roleId: roles.pm },
      { id: users.engineer, email: engineer.email, name: engineer.name, passwordHash: "acceptance-only", roleId: roles.engineer },
      { id: users.other, email: other.email, name: other.name, passwordHash: "acceptance-only", roleId: roles.pm },
    ] });
    await prisma.project.create({ data: { id: projectId, code: `P7-${suffix}`, name: "阶段 7 受控动作项目", ownerId: users.pm } });
    await prisma.projectMember.createMany({ data: [
      { projectId, userId: users.pm, roleId: roles.pm },
      { projectId, userId: users.engineer, roleId: roles.engineer },
      { projectId, userId: users.other, roleId: roles.pm },
    ] });
    await prisma.task.createMany({ data: Object.values(tasks).map((taskId, index) => ({
      id: taskId,
      projectId,
      title: `阶段 7 动作任务 ${index + 1}`,
      description: "原始描述",
      priority: "P2",
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
      estimatedHours: 8,
      assigneeId: users.engineer,
      createdBy: users.engineer,
    })) });
    await prisma.agentRun.createMany({ data: [
      { id: runs.engineer, userId: users.engineer, sessionId: id("session-engineer"), status: "RUNNING", expiresAt: new Date(now.getTime() + 30 * 60_000) },
      { id: runs.pm, userId: users.pm, sessionId: id("session-pm"), status: "RUNNING", expiresAt: new Date(now.getTime() + 30 * 60_000) },
      { id: runs.other, userId: users.other, sessionId: id("session-other"), status: "RUNNING", expiresAt: new Date(now.getTime() + 30 * 60_000) },
    ] });

    const gateway = createProductionToolGateway({ cursorSecret: "phase-seven-isolated-cursor-secret-32-bytes", clock });
    const service = new PrismaActionService(prisma, clock);
    let requestSequence = 0;
    const toolContext = (actor: keyof typeof runs): ToolExecutionContext => ({
      runId: runs[actor],
      traceId: `trace-p7-${requestSequence}`,
      requestId: `${runs[actor]}:proposal:${requestSequence}`,
      sessionSubject: users[actor],
      issuedAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
    });
    const propose = async (
      actor: keyof typeof runs,
      taskId: string,
      changes: Record<string, unknown>,
      idempotencyKey: string,
    ) => {
      requestSequence += 1;
      const result = await gateway.invoke("plm_action_propose_task_update", {
        taskId,
        changes,
        reason: "阶段 7 确定性验收",
        idempotencyKey,
      }, toolContext(actor)) as Record<string, any>;
      assertCondition(result.ok === true, `动作提议失败：${JSON.stringify(result)}`);
      return result;
    };

    const enabledActions = ACTION_DEFINITIONS.filter((definition) => definition.status === "enabled");
    assertCondition(enabledActions.length === 1 && enabledActions[0].actionType === "TASK_UPDATE_LOW_RISK", "动作注册表开放了未经批准的动作");
    assertCondition(ACTION_DEFINITIONS.filter((definition) => ["HIGH", "FORBIDDEN"].includes(definition.riskLevel)).every((definition) => definition.status === "disabled"), "高风险动作未全部禁用");

    const beforeProposal = await taskSnapshot(tasks.success);
    requestSequence += 1;
    const idempotentContext = toolContext("engineer");
    const proposalInput = { taskId: tasks.success, changes: { description: "经人工确认后更新", priority: "P1", estimatedHours: 13 }, reason: "阶段 7 确定性验收", idempotencyKey: "success-idempotency-key" };
    const firstProposal = await gateway.invoke("plm_action_propose_task_update", proposalInput, idempotentContext) as Record<string, any>;
    const replayProposal = await gateway.invoke("plm_action_propose_task_update", proposalInput, idempotentContext) as Record<string, any>;
    assertCondition(firstProposal.ok && replayProposal.ok && firstProposal.data.proposalId === replayProposal.data.proposalId, "相同提议幂等键产生重复审批记录");
    assertCondition(await taskSnapshot(tasks.success) === beforeProposal, "proposal Tool 在人工确认前改写了任务");
    assertCondition(await prisma.agentApprovalRequest.count({ where: { targetEntityId: tasks.success } }) === 1, "幂等提议产生了重复记录");
    assertCondition(await prisma.agentToolExecution.count({ where: { requestId: idempotentContext.requestId } }) === 1, "幂等 Tool 调用产生了重复审计");
    console.log("[agent-action-db] PASS proposal 只写治理记录，相同幂等键仅一条提议与一条 Tool 审计");

    const successView = (await service.listOwnedProposals(engineer, runs.engineer)).find((item) => item.id === firstProposal.data.proposalId)!;
    assertCondition(successView.canExecute && successView.approvalToken, "确认页未签发绑定当前用户的一次性授权");
    await expectApiError(
      () => service.executeOwnedProposal(engineer, successView.id, { confirmationText: "确认执行", expectedVersion: successView.expectedVersion } as any),
      400,
      "缺少确认令牌",
    );
    await expectApiError(
      () => service.executeOwnedProposal(other, successView.id, { approvalToken: successView.approvalToken!, confirmationText: "确认执行", expectedVersion: successView.expectedVersion }),
      404,
      "他人确认",
    );
    assertCondition(await taskSnapshot(tasks.success) === beforeProposal, "无令牌或他人确认改写了任务");

    const [executedA, executedB] = await Promise.all([
      service.executeOwnedProposal(engineer, successView.id, { approvalToken: successView.approvalToken!, confirmationText: "确认执行", expectedVersion: successView.expectedVersion }),
      service.executeOwnedProposal(engineer, successView.id, { approvalToken: successView.approvalToken!, confirmationText: "确认执行", expectedVersion: successView.expectedVersion }),
    ]);
    assertCondition(executedA.readback.priority === "P1" && executedA.readback.estimatedHours === 13, "成功执行回读与提议不一致");
    assertCondition([executedA.replayed, executedB.replayed].filter(Boolean).length === 1, "并发幂等执行未返回一次执行与一次重放");
    const successApproval = await prisma.agentApprovalRequest.findUniqueOrThrow({ where: { id: successView.id } });
    const successAuditCount = await prisma.auditLog.count({ where: { correlationId: successView.id, entityType: "TASK", action: "UPDATE" } });
    const successActivityCount = await prisma.activityEvent.count({ where: { correlationId: successView.id, eventType: "task.agent_updated" } });
    assertCondition(successApproval.status === "EXECUTED" && successApproval.executionResultJson && successApproval.readbackJson, "审批记录未原子进入 EXECUTED 并保存回读");
    assertCondition(successAuditCount === 1 && successActivityCount === 1, "并发执行产生重复业务审计或活动事件");
    assertCondition(successApproval.id === executedA.auditCorrelationId, "Agent 审批与业务审计 correlationId 未串联");
    console.log("[agent-action-db] PASS 人工确认后原子执行；并发重放只产生一次任务写入、一次业务审计和一次活动事件");

    const conflictProposal = await propose("engineer", tasks.conflict, { priority: "P0" }, "conflict-idempotency-key");
    const conflictView = (await service.listOwnedProposals(engineer, runs.engineer)).find((item) => item.id === conflictProposal.data.proposalId)!;
    await prisma.task.update({ where: { id: tasks.conflict }, data: { description: "并发用户先行修改" } });
    await expectApiError(
      () => service.executeOwnedProposal(engineer, conflictView.id, { approvalToken: conflictView.approvalToken!, confirmationText: "确认执行", expectedVersion: conflictView.expectedVersion }),
      409,
      "目标版本变化",
    );
    const conflictTask = await prisma.task.findUniqueOrThrow({ where: { id: tasks.conflict } });
    const conflictApproval = await prisma.agentApprovalRequest.findUniqueOrThrow({ where: { id: conflictView.id } });
    assertCondition(conflictTask.priority === "P2" && conflictApproval.status === "CONFLICT", "版本冲突仍应用了提议字段");

    const permissionProposal = await propose("engineer", tasks.permission, { estimatedHours: 21 }, "permission-idempotency-key");
    const permissionView = (await service.listOwnedProposals(engineer, runs.engineer)).find((item) => item.id === permissionProposal.data.proposalId)!;
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId: users.engineer } } });
    await expectApiError(
      () => service.executeOwnedProposal(engineer, permissionView.id, { approvalToken: permissionView.approvalToken!, confirmationText: "确认执行", expectedVersion: permissionView.expectedVersion }),
      403,
      "执行前权限撤销",
    );
    assertCondition((await prisma.task.findUniqueOrThrow({ where: { id: tasks.permission } })).estimatedHours === 8, "权限撤销后仍执行写入");
    assertCondition((await prisma.agentApprovalRequest.findUniqueOrThrow({ where: { id: permissionView.id } })).failureCode === "PERMISSION_REVOKED", "权限复核失败未记录原因");
    await prisma.projectMember.create({ data: { projectId, userId: users.engineer, roleId: roles.engineer } });

    const expiredProposal = await propose("engineer", tasks.expired, { dueDate: "2026-08-30" }, "expired-idempotency-key");
    const expiredView = (await service.listOwnedProposals(engineer, runs.engineer)).find((item) => item.id === expiredProposal.data.proposalId)!;
    await prisma.agentApprovalRequest.update({ where: { id: expiredView.id }, data: { expiresAt: new Date(now.getTime() + 60_000) } });
    now = new Date(now.getTime() + 2 * 60_000);
    await expectApiError(
      () => service.executeOwnedProposal(engineer, expiredView.id, { approvalToken: expiredView.approvalToken!, confirmationText: "确认执行", expectedVersion: expiredView.expectedVersion }),
      409,
      "过期确认",
    );
    assertCondition((await prisma.agentApprovalRequest.findUniqueOrThrow({ where: { id: expiredView.id } })).status === "EXPIRED", "过期提议未进入终态");
    assertCondition((await prisma.task.findUniqueOrThrow({ where: { id: tasks.expired } })).dueDate?.toISOString().slice(0, 10) === "2026-08-20", "过期确认仍改写任务");

    const cancelledProposal = await propose("engineer", tasks.cancelled, { description: "不应写入" }, "cancelled-idempotency-key");
    const cancelledView = (await service.listOwnedProposals(engineer, runs.engineer)).find((item) => item.id === cancelledProposal.data.proposalId)!;
    await service.cancelOwnedProposal(engineer, cancelledView.id);
    await expectApiError(
      () => service.executeOwnedProposal(engineer, cancelledView.id, { approvalToken: cancelledView.approvalToken!, confirmationText: "确认执行", expectedVersion: cancelledView.expectedVersion }),
      403,
      "取消后执行",
    );
    assertCondition((await prisma.task.findUniqueOrThrow({ where: { id: tasks.cancelled } })).description === "原始描述", "取消提议仍改写任务");
    console.log("[agent-action-db] PASS 版本变化、权限撤销、过期、取消、缺令牌与他人确认均无法写入");

    const forbiddenBusinessAudits = await prisma.auditLog.count({ where: { eventType: "agent.action.executed", entityType: { not: "TASK" } } });
    assertCondition(forbiddenBusinessAudits === 0, "出现未经注册的 Action Agent 业务审计");
    console.log("AGENT_ACTION_DB_ACCEPTANCE=PASS");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("AGENT_ACTION_DB_ACCEPTANCE=FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
