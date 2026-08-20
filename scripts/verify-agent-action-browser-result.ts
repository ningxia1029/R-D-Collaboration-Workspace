import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ errorFormat: "minimal" });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

async function read(proposalId: string) {
  const approval = await prisma.agentApprovalRequest.findUniqueOrThrow({
    where: { id: proposalId },
    select: { id: true, status: true, targetEntityId: true },
  });
  if (!approval.targetEntityId) throw new Error("提议缺少目标任务");
  const [task, audits] = await Promise.all([
    prisma.task.findUniqueOrThrow({
      where: { id: approval.targetEntityId },
      select: { priority: true, estimatedHours: true, dueDate: true },
    }),
    prisma.auditLog.count({ where: { correlationId: proposalId, entityType: "TASK", action: "UPDATE" } }),
  ]);
  return { ...approval, ...task, dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null, audits };
}

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (!/^workbuddy_phase7_[a-zA-Z0-9_]+$/.test(databaseName) || required("AGENT_ACTION_BROWSER_TARGET_ACK") !== databaseName) {
    throw new Error("只允许读取已确认的阶段 7 隔离库");
  }
  const executed = await read(required("PHASE7_EXECUTED_PROPOSAL_ID"));
  const pending = await read(required("PHASE7_PENDING_PROPOSAL_ID"));
  if (executed.status !== "EXECUTED" || executed.priority !== "P1" || executed.estimatedHours !== 12 || executed.dueDate !== "2026-08-28" || executed.audits !== 1) {
    throw new Error(`执行后回读不匹配：${JSON.stringify(executed)}`);
  }
  if (pending.status !== "PENDING" || pending.priority !== "P2" || pending.estimatedHours !== 8 || pending.dueDate !== "2026-08-25" || pending.audits !== 0) {
    throw new Error(`未确认提议出现业务副作用：${JSON.stringify(pending)}`);
  }
  console.log(`[agent-action-browser] executed=${JSON.stringify(executed)}`);
  console.log(`[agent-action-browser] pending=${JSON.stringify(pending)}`);
  console.log("AGENT_ACTION_BROWSER_RESULT=PASS");
}

main()
  .catch((error: unknown) => {
    console.error("AGENT_ACTION_BROWSER_RESULT=FAIL", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
