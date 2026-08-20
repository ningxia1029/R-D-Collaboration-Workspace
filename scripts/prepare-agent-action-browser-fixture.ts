import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaActionService } from "../src/lib/agent/actions/service";
import type { ToolExecutionContext } from "../src/lib/agent/tools/contracts";
import { createProductionToolGateway } from "../src/lib/agent/tools/production";

const prisma = new PrismaClient({ errorFormat: "minimal" });
const PASSWORD = "Phase7Browser!2026";
process.env.AGENT_ACTION_APPROVAL_SECRET = "phase-seven-browser-action-approval-secret-32-bytes";

function requireIsolatedTarget(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (parsed.hostname !== "127.0.0.1" || !/^workbuddy_phase7_[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error("浏览器夹具只允许阶段 7 本机隔离库");
  }
  if (process.env.AGENT_ACTION_BROWSER_TARGET_ACK !== databaseName) throw new Error("AGENT_ACTION_BROWSER_TARGET_ACK 不匹配");
  return databaseName;
}

async function main() {
  const databaseName = requireIsolatedTarget();
  const engineer = await prisma.user.findFirstOrThrow({
    where: { name: "阶段 7 工程师" },
    include: { role: true, memberships: { take: 1 } },
  });
  const projectId = engineer.memberships[0]?.projectId;
  if (!projectId) throw new Error("阶段 7 工程师缺少项目成员关系");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const runId = `p7-browser-run-${suffix}`;
  const taskId = `p7-browser-task-${suffix}`;
  const now = new Date();
  await prisma.user.update({ where: { id: engineer.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 10) } });
  await prisma.agentControlSetting.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: true, disabledToolsJson: [], updatedById: engineer.id },
    update: { enabled: true, disabledToolsJson: [], maintenanceMessage: null, updatedById: engineer.id },
  });
  await prisma.task.create({
    data: {
      id: taskId,
      projectId,
      title: "阶段 7 浏览器确认卡验收",
      description: "当前描述：等待结构化复核",
      priority: "P2",
      dueDate: new Date("2026-08-25T00:00:00.000Z"),
      estimatedHours: 8,
      assigneeId: engineer.id,
      createdBy: engineer.id,
    },
  });
  await prisma.agentRun.create({
    data: {
      id: runId,
      userId: engineer.id,
      sessionId: randomUUID(),
      status: "RUNNING",
      currentNode: "tool",
      promptVersion: "plm-agent-system@1.2.0",
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      messages: {
        create: [
          { sequence: 0, role: "user", content: "请把浏览器验收任务优先级调整为 P1，并将预估工时改为 12 小时。" },
          { sequence: 1, role: "assistant", content: "已生成低风险任务更新提议。业务数据尚未修改，请在确认卡逐字段复核。" },
        ],
      },
      events: { create: { sequence: 1, eventType: "RUN_STARTED", payload: { fixture: true } } },
    },
  });
  const context: ToolExecutionContext = {
    runId,
    traceId: `trace-${runId}`,
    requestId: `${runId}:proposal:0`,
    sessionSubject: engineer.id,
    issuedAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
  };
  const gateway = createProductionToolGateway({ cursorSecret: "phase-seven-browser-cursor-secret-32-bytes", clock: () => now });
  const proposed = await gateway.invoke("plm_action_propose_task_update", {
    taskId,
    changes: { priority: "P1", estimatedHours: 12, dueDate: "2026-08-28" },
    reason: "验证结构化 before/after 与确认门禁",
    idempotencyKey: `browser-${suffix}`,
  }, context) as Record<string, any>;
  if (!proposed.ok) throw new Error(`创建浏览器动作提议失败：${JSON.stringify(proposed)}`);
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "SUCCEEDED", currentNode: "done", completedAt: now },
  });
  const view = await new PrismaActionService(prisma, () => now).listOwnedProposals(
    { id: engineer.id, email: engineer.email, name: engineer.name, roleId: engineer.roleId, roleName: "engineer" },
    runId,
  );
  if (!view[0]?.canExecute) throw new Error("浏览器动作提议无法签发确认令牌");
  console.log(`PHASE7_BROWSER_DB=${databaseName}`);
  console.log(`PHASE7_BROWSER_EMAIL=${engineer.email}`);
  console.log(`PHASE7_BROWSER_PASSWORD=${PASSWORD}`);
  console.log(`PHASE7_BROWSER_RUN_ID=${runId}`);
  console.log(`PHASE7_BROWSER_PROPOSAL_ID=${view[0].id}`);
}

main()
  .catch((error: unknown) => {
    console.error("PHASE7_BROWSER_FIXTURE=FAIL", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
