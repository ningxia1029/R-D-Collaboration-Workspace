import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const REQUIRED_INDEXES = [
  "Users_primary_org_unit_id_idx",
  "Users_position_id_idx",
  "Users_manager_id_idx",
  "Audit_Logs_project_id_created_at_idx",
  "Audit_Logs_correlation_id_idx",
] as const;

function requireIsolatedTarget(): { databaseName: string; host: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL；拒绝猜测验收库");

  const parsedUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL 必须是 PostgreSQL 连接串");
  }
  if (process.env.AGENT_DB_VERIFY_TARGET_ACK !== databaseName) {
    throw new Error("AGENT_DB_VERIFY_TARGET_ACK 必须与 DATABASE_URL 中的数据库名完全一致");
  }
  if (process.env.AGENT_DB_VERIFY_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error("仅允许隔离库验收；必须显式设置 AGENT_DB_VERIFY_ALLOW_DESTRUCTIVE=1");
  }
  return { databaseName, host: parsedUrl.hostname };
}

function isDatabaseRejection(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  );
}

async function expectDatabaseRejection(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    if (!isDatabaseRejection(error)) throw error;
    console.log(`[agent-db-verify] 数据库已拒绝：${label}`);
    return;
  }
  throw new Error(`数据库未拒绝负例：${label}`);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const target = requireIsolatedTarget();
  const prisma = new PrismaClient({ errorFormat: "minimal" });
  const suffix = randomUUID().replace(/-/g, "");
  const roleId = `phase1-role-${suffix}`;
  const userId = `phase1-user-${suffix}`;
  const orgUnitId = `phase1-org-${suffix}`;
  const projectId = `phase1-project-${suffix}`;
  const activityId = `phase1-activity-${suffix}`;
  const runId = `phase1-run-${suffix}`;
  const sessionId = `phase1-session-${suffix}`;

  console.log(`[agent-db-verify] 已确认隔离目标 ${target.host}/${target.databaseName}`);

  try {
    await prisma.role.create({
      data: { id: roleId, name: `phase1-role-${suffix}`, description: "阶段 1 数据库验收临时角色" },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: `phase1-${suffix}@invalid.local`,
        name: "阶段 1 验收用户",
        passwordHash: "not-a-login-credential",
        roleId,
      },
    });

    await expectDatabaseRejection("周产能小于 0", () =>
      prisma.user.update({ where: { id: userId }, data: { weeklyCapacityHours: -1 } }),
    );
    await expectDatabaseRejection("用户成为自己的直属经理", () =>
      prisma.user.update({ where: { id: userId }, data: { managerId: userId } }),
    );
    await expectDatabaseRejection("组织单元自引用", () =>
      prisma.$executeRawUnsafe(
        'INSERT INTO "Org_Units" ("id", "code", "name", "parent_id", "status", "updated_at") VALUES ($1, $2, $3, $1, \'active\', CURRENT_TIMESTAMP)',
        orgUnitId,
        `phase1-org-${suffix}`,
        "阶段 1 验收组织",
      ),
    );
    await expectDatabaseRejection("非法 Agent Run 状态", () =>
      prisma.agentRun.create({
        data: { id: `${runId}-invalid`, userId, sessionId, status: "UNKNOWN" },
      }),
    );

    await prisma.agentRun.create({
      data: {
        id: runId,
        userId,
        sessionId,
        status: "RUNNING",
        idempotencyKey: `phase1-run-key-${suffix}`,
      },
    });
    await expectDatabaseRejection("重复 Agent Run 幂等键", () =>
      prisma.agentRun.create({
        data: {
          id: `${runId}-duplicate`,
          userId,
          sessionId,
          idempotencyKey: `phase1-run-key-${suffix}`,
        },
      }),
    );

    await prisma.agentMessage.create({
      data: { id: `phase1-message-${suffix}`, runId, sequence: 0, role: "user", content: "acceptance" },
    });
    await expectDatabaseRejection("同一 Run 重复消息序号", () =>
      prisma.agentMessage.create({
        data: { id: `phase1-message-duplicate-${suffix}`, runId, sequence: 0, role: "assistant" },
      }),
    );
    await expectDatabaseRejection("Outbox 重试次数小于 0", () =>
      prisma.outboxEvent.create({
        data: {
          id: `phase1-outbox-${suffix}`,
          aggregateType: "acceptance",
          aggregateId: suffix,
          eventType: "acceptance.invalid",
          dedupKey: `phase1-outbox-${suffix}`,
          payloadJson: { acceptance: true },
          attempts: -1,
        },
      }),
    );

    await prisma.project.create({
      data: { id: projectId, name: "阶段 1 验收项目", code: `PHASE1-${suffix}` },
    });
    await prisma.activityEvent.create({
      data: {
        id: activityId,
        projectId,
        actorUserId: userId,
        eventType: "acceptance.created",
        entityType: "Project",
        entityId: projectId,
      },
    });
    await prisma.project.delete({ where: { id: projectId } });
    const retainedActivity = await prisma.activityEvent.findUniqueOrThrow({ where: { id: activityId } });
    assertCondition(retainedActivity.projectId === null, "删除项目后 ActivityEvent.projectId 未按约定置空");
    console.log("[agent-db-verify] 通过：项目删除后活动事实保留并解除外键");

    await prisma.agentRunEvent.create({
      data: { id: `phase1-event-${suffix}`, runId, sequence: 0, eventType: "run.started" },
    });
    await prisma.agentToolExecution.create({
      data: { id: `phase1-tool-${suffix}`, runId, requestId: `phase1-request-${suffix}`, toolName: "acceptance" },
    });
    await prisma.agentCheckpoint.create({
      data: {
        id: `phase1-checkpoint-${suffix}`,
        runId,
        checkpointId: "0",
        stateJson: { node: "acceptance" },
      },
    });
    await prisma.agentFeedback.create({
      data: { id: `phase1-feedback-${suffix}`, runId, userId, rating: "UP" },
    });
    await prisma.agentApprovalRequest.create({
      data: {
        id: `phase1-approval-${suffix}`,
        runId,
        requestedById: userId,
        actionType: "acceptance.noop",
        riskLevel: "LOW",
        proposalJson: { acceptance: true },
        idempotencyKey: `phase1-approval-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.agentRun.delete({ where: { id: runId } });
    const childCounts = await Promise.all([
      prisma.agentMessage.count({ where: { runId } }),
      prisma.agentRunEvent.count({ where: { runId } }),
      prisma.agentToolExecution.count({ where: { runId } }),
      prisma.agentCheckpoint.count({ where: { runId } }),
      prisma.agentFeedback.count({ where: { runId } }),
      prisma.agentApprovalRequest.count({ where: { runId } }),
    ]);
    assertCondition(childCounts.every((count) => count === 0), "删除 AgentRun 后仍存在未级联清理的子记录");
    console.log("[agent-db-verify] 通过：Agent Run 六类子记录级联清理");

    const indexRows = await prisma.$queryRaw<Array<{ valid_count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS valid_count
      FROM pg_index AS index_meta
      JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
      JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = current_schema()
        AND index_class.relname IN (${Prisma.join(REQUIRED_INDEXES)})
        AND index_meta.indisvalid
        AND index_meta.indisready
    `);
    assertCondition(indexRows[0]?.valid_count === REQUIRED_INDEXES.length, "五个在线索引并非全部 valid/ready");
    console.log(`[agent-db-verify] 通过：在线索引 ${REQUIRED_INDEXES.length}/${REQUIRED_INDEXES.length} valid/ready`);
    console.log("[agent-db-verify] 阶段 1 数据库约束验收通过");
  } finally {
    await prisma.agentRun.deleteMany({ where: { sessionId } }).catch(() => undefined);
    await prisma.activityEvent.deleteMany({ where: { id: activityId } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    await prisma.orgUnit.deleteMany({ where: { id: orgUnitId } }).catch(() => undefined);
    await prisma.outboxEvent.deleteMany({ where: { dedupKey: { startsWith: `phase1-outbox-${suffix}` } } }).catch(
      () => undefined,
    );
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.role.deleteMany({ where: { id: roleId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[agent-db-verify] 失败", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
