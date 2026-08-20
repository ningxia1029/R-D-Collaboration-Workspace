import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const source = new PrismaClient();

function isolatedDatabaseName(raw: string | undefined, label: string): string {
  if (!raw) throw new Error(`缺少 ${label}`);
  const parsed = new URL(raw);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^(postgresql|postgres):$/.test(parsed.protocol) || parsed.hostname !== "127.0.0.1") {
    throw new Error(`${label} 只允许 127.0.0.1 PostgreSQL 隔离库`);
  }
  if (!/^workbuddy_phase8_[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error(`${label} 数据库名不符合阶段 8 隔离命名规则`);
  }
  return databaseName;
}

function normalize(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(normalize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${normalize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(normalize(value), "utf8").digest("hex");
}

async function snapshot(db: PrismaClient) {
  const [roles, users, projects, tasks, runs, messages, approvals] = await Promise.all([
    db.role.findMany({ orderBy: { id: "asc" } }),
    db.user.findMany({ orderBy: { id: "asc" } }),
    db.project.findMany({ orderBy: { id: "asc" } }),
    db.task.findMany({ orderBy: { id: "asc" } }),
    db.agentRun.findMany({ orderBy: { id: "asc" } }),
    db.agentMessage.findMany({ orderBy: { id: "asc" } }),
    db.agentApprovalRequest.findMany({ orderBy: { id: "asc" } }),
  ]);
  const value = { roles, users, projects, tasks, runs, messages, approvals };
  return {
    counts: Object.fromEntries(Object.entries(value).map(([key, rows]) => [key, rows.length])),
    digest: digest(value),
  };
}

async function seed(): Promise<void> {
  const sourceName = isolatedDatabaseName(process.env.DATABASE_URL, "DATABASE_URL");
  if (process.env.AGENT_RELEASE_VERIFY_TARGET_ACK !== sourceName) throw new Error("源库确认值不匹配");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const ids = {
    role: `p8-role-${suffix}`,
    user: `p8-user-${suffix}`,
    project: `p8-project-${suffix}`,
    task: `p8-task-${suffix}`,
    run: `p8-run-${suffix}`,
    message: `p8-message-${suffix}`,
    approval: `p8-approval-${suffix}`,
  };
  await source.$transaction(async (tx) => {
    await tx.role.create({ data: { id: ids.role, name: `phase8-${suffix}`, description: "阶段 8 恢复演练" } });
    await tx.user.create({ data: { id: ids.user, email: `${ids.user}@invalid.local`, name: "阶段 8 恢复用户", passwordHash: "acceptance-only", roleId: ids.role } });
    await tx.project.create({ data: { id: ids.project, code: `P8-${suffix}`, name: "阶段 8 恢复项目", ownerId: ids.user } });
    await tx.task.create({ data: { id: ids.task, projectId: ids.project, title: "恢复演练任务", createdBy: ids.user, assigneeId: ids.user } });
    await tx.agentRun.create({ data: { id: ids.run, userId: ids.user, sessionId: `p8-session-${suffix}`, status: "WAITING_FOR_USER", promptVersion: "plm-agent-system@1.2.0", retentionUntil: new Date("2026-09-12T00:00:00.000Z") } });
    await tx.agentMessage.create({ data: { id: ids.message, runId: ids.run, sequence: 1, role: "user", content: "阶段 8 恢复演练消息", redacted: false } });
    await tx.agentApprovalRequest.create({ data: { id: ids.approval, runId: ids.run, requestedById: ids.user, status: "PENDING", actionType: "TASK_UPDATE_LOW_RISK", riskLevel: "LOW", targetEntityType: "TASK", targetEntityId: ids.task, expectedVersion: "2026-08-13T00:00:00.000Z", proposalJson: { changes: { priority: "P1" } }, idempotencyKey: `p8-proposal-${suffix}`, expiresAt: new Date("2026-08-13T01:00:00.000Z") } });
  });
  const result = await snapshot(source);
  console.log(`[agent-restore] mode=seed source=${sourceName} counts=${JSON.stringify(result.counts)} digest=${result.digest}`);
}

async function compare(): Promise<void> {
  const sourceName = isolatedDatabaseName(process.env.DATABASE_URL, "DATABASE_URL");
  const targetUrl = process.env.AGENT_RESTORE_DATABASE_URL;
  const targetName = isolatedDatabaseName(targetUrl, "AGENT_RESTORE_DATABASE_URL");
  if (sourceName === targetName) throw new Error("源库与恢复目标库必须不同");
  if (process.env.AGENT_RELEASE_VERIFY_TARGET_ACK !== `${sourceName}->${targetName}`) throw new Error("源库到目标库确认值不匹配");
  const target = new PrismaClient({ datasources: { db: { url: targetUrl! } } });
  try {
    const [sourceSnapshot, targetSnapshot] = await Promise.all([snapshot(source), snapshot(target)]);
    if (sourceSnapshot.digest !== targetSnapshot.digest) {
      throw new Error(`恢复摘要不一致 source=${sourceSnapshot.digest} target=${targetSnapshot.digest}`);
    }
    console.log(`[agent-restore] mode=compare source=${sourceName} target=${targetName} counts=${JSON.stringify(sourceSnapshot.counts)} digest=${sourceSnapshot.digest}`);
    console.log("[agent-restore] PASS source/target 全表抽样摘要一致");
  } finally {
    await target.$disconnect();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "seed") await seed();
  else if (mode === "compare") await compare();
  else throw new Error("用法：tsx scripts/verify-agent-restore-db.ts {seed|compare}");
}

main()
  .catch((error: unknown) => {
    console.error(`[agent-restore] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => source.$disconnect());
