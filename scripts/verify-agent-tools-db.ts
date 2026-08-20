import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createProductionToolGateway } from "../src/lib/agent/tools/production";
import { backfillKnowledgeIndex } from "../src/lib/agent/knowledge/indexer";
import type { ToolExecutionContext, ToolName } from "../src/lib/agent/tools/contracts";

const prisma = new PrismaClient({ errorFormat: "minimal" });
const NOW = new Date("2026-08-12T04:00:00.000Z");
const TOOL_NAMES: ToolName[] = [
  "plm_project_resolve",
  "plm_project_get_summary",
  "plm_task_list",
  "plm_task_get_dependencies",
  "plm_milestone_list",
  "plm_bom_get_risks",
  "plm_change_get_impact",
  "plm_document_search",
];

function requireIsolatedTarget(): { databaseName: string; host: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL；拒绝猜测阶段 2 验收库");
  const parsedUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL 必须是 PostgreSQL 连接串");
  }
  if (process.env.AGENT_TOOL_VERIFY_TARGET_ACK !== databaseName) {
    throw new Error("AGENT_TOOL_VERIFY_TARGET_ACK 必须与 DATABASE_URL 中的数据库名完全一致");
  }
  if (process.env.AGENT_TOOL_VERIFY_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error("仅允许可丢弃隔离库；必须显式设置 AGENT_TOOL_VERIFY_ALLOW_DESTRUCTIVE=1");
  }
  return { databaseName, host: parsedUrl.hostname };
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function businessSnapshot(): Promise<string> {
  const [
    roles,
    users,
    orgUnits,
    positions,
    projects,
    members,
    phases,
    tasks,
    dependencies,
    milestones,
    bomItems,
    ecrs,
    ecos,
    impacts,
    approvals,
    documents,
    versions,
    tags,
    documentTags,
    documentChunks,
    auditLogs,
    activities,
    outbox,
  ] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: "asc" } }),
    prisma.user.findMany({ orderBy: { id: "asc" } }),
    prisma.orgUnit.findMany({ orderBy: { id: "asc" } }),
    prisma.position.findMany({ orderBy: { id: "asc" } }),
    prisma.project.findMany({ orderBy: { id: "asc" } }),
    prisma.projectMember.findMany({ orderBy: [{ projectId: "asc" }, { userId: "asc" }] }),
    prisma.phase.findMany({ orderBy: { id: "asc" } }),
    prisma.task.findMany({ orderBy: { id: "asc" } }),
    prisma.taskDependency.findMany({ orderBy: { id: "asc" } }),
    prisma.milestone.findMany({ orderBy: { id: "asc" } }),
    prisma.bomItem.findMany({ orderBy: { id: "asc" } }),
    prisma.changeRequest.findMany({ orderBy: { id: "asc" } }),
    prisma.changeLog.findMany({ orderBy: { id: "asc" } }),
    prisma.changeImpact.findMany({ orderBy: { id: "asc" } }),
    prisma.approvalRecord.findMany({ orderBy: { id: "asc" } }),
    prisma.document.findMany({ orderBy: { id: "asc" } }),
    prisma.docVersion.findMany({ orderBy: { id: "asc" } }),
    prisma.tag.findMany({ orderBy: { id: "asc" } }),
    prisma.documentTag.findMany({ orderBy: [{ documentId: "asc" }, { tagId: "asc" }] }),
    prisma.agentDocumentChunk.findMany({ orderBy: { id: "asc" } }),
    prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
    prisma.activityEvent.findMany({ orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({
    roles,
    users,
    orgUnits,
    positions,
    projects,
    members,
    phases,
    tasks,
    dependencies,
    milestones,
    bomItems,
    ecrs,
    ecos,
    impacts,
    approvals,
    documents,
    versions,
    tags,
    documentTags,
    documentChunks,
    auditLogs,
    activities,
    outbox,
  });
}

async function main(): Promise<void> {
  const target = requireIsolatedTarget();
  const suffix = randomUUID().replace(/-/g, "");
  const id = (kind: string) => `phase2-${kind}-${suffix}`;
  const roles = {
    admin: id("role-admin"),
    pm: id("role-pm"),
    engineer: id("role-engineer"),
    viewer: id("role-viewer"),
  } as const;
  const users = {
    admin: id("user-admin"),
    pm: id("user-pm"),
    engineer: id("user-engineer"),
    viewer: id("user-viewer"),
    outsider: id("user-outsider"),
    inactive: id("user-inactive"),
  } as const;
  const projectId = id("project-visible");
  const hiddenProjectId = id("project-hidden");
  const phaseId = id("phase");
  const taskDoneId = id("task-done");
  const taskBlockedId = id("task-blocked");
  const ecoId = id("eco");
  const ecrId = id("ecr");
  const visibleDocumentId = id("document-visible");
  const sharedDocumentId = id("document-shared");
  const hiddenDocumentId = id("document-hidden");
  const runIds = new Map<string, string>();
  const projectCode = `P2-${suffix.slice(0, 12)}`;
  const ecoNumber = `ECO-P2-${suffix.slice(0, 12)}`;
  const needle = `phase2needle-${suffix.slice(0, 8)}`;

  console.log(`[agent-tool-db] 已确认隔离目标 ${target.host}/${target.databaseName}`);

  try {
    await prisma.role.createMany({
      data: [
        { id: roles.admin, name: "admin", description: "阶段 2 admin" },
        { id: roles.pm, name: "pm", description: "阶段 2 pm" },
        { id: roles.engineer, name: "engineer", description: "阶段 2 engineer" },
        { id: roles.viewer, name: "viewer", description: "阶段 2 viewer" },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: users.admin, email: `admin-${suffix}@invalid.local`, name: "管理员", passwordHash: "acceptance-only", roleId: roles.admin },
        { id: users.pm, email: `pm-${suffix}@invalid.local`, name: "项目经理", passwordHash: "acceptance-only", roleId: roles.pm },
        { id: users.engineer, email: `engineer-${suffix}@invalid.local`, name: "工程师", passwordHash: "acceptance-only", roleId: roles.engineer },
        { id: users.viewer, email: `viewer-${suffix}@invalid.local`, name: "观察者", passwordHash: "acceptance-only", roleId: roles.viewer },
        { id: users.outsider, email: `outsider-${suffix}@invalid.local`, name: "非项目成员", passwordHash: "acceptance-only", roleId: roles.viewer },
        { id: users.inactive, email: `inactive-${suffix}@invalid.local`, name: "已停用用户", passwordHash: "acceptance-only", roleId: roles.viewer, status: "inactive" },
      ],
    });
    await prisma.project.createMany({
      data: [
        { id: projectId, code: projectCode, name: "阶段 2 可见项目", ownerId: users.pm, lifecycleStage: "RD" },
        { id: hiddenProjectId, code: `HIDDEN-${suffix.slice(0, 12)}`, name: "阶段 2 隐藏项目", ownerId: users.admin, lifecycleStage: "RD" },
      ],
    });
    await prisma.projectMember.createMany({
      data: [
        { projectId, userId: users.pm, roleId: roles.pm },
        { projectId, userId: users.engineer, roleId: roles.engineer },
        { projectId, userId: users.viewer, roleId: roles.viewer },
      ],
    });
    await prisma.phase.create({
      data: { id: phaseId, projectId, phaseName: "EVT", status: "active", sortOrder: 1 },
    });
    await prisma.task.createMany({
      data: [
        { id: taskDoneId, projectId, phaseId, title: "阶段 2 已完成任务", status: "Done", priority: "P1", dueDate: new Date("2026-08-09T00:00:00Z"), createdBy: users.pm },
        { id: taskBlockedId, projectId, phaseId, title: "阶段 2 阻塞任务", status: "Blocked", priority: "P0", dueDate: new Date("2026-08-10T00:00:00Z"), assigneeId: users.engineer, createdBy: users.pm },
      ],
    });
    await prisma.taskDependency.create({
      data: { id: id("dependency"), predecessorId: taskDoneId, successorId: taskBlockedId, type: "FS", lagDays: 1 },
    });
    await prisma.milestone.create({
      data: { id: id("milestone"), projectId, phaseId, name: "EVT 评审", date: new Date("2026-08-10T00:00:00Z"), status: "pending" },
    });
    await prisma.bomItem.createMany({
      data: [
        { id: id("bom-arrived"), projectId, phaseId, mpn: "P2-ARRIVED", name: "已到货器件", qty: 1, status: "Arrived" },
        { id: id("bom-delayed"), projectId, phaseId, mpn: "P2-DELAYED", name: "延迟关键器件", qty: 10, status: "Delayed", isCritical: true, eta: new Date("2026-08-11T00:00:00Z") },
      ],
    });
    await prisma.changeRequest.create({
      data: { id: ecrId, ecrNumber: `ECR-P2-${suffix.slice(0, 12)}`, projectId, title: "器件替代申请", type: "Hardware", reason: "交期风险", status: "CONVERTED", requestedBy: users.engineer },
    });
    await prisma.changeLog.create({
      data: { id: ecoId, ecoNumber, projectId, type: "Hardware", reason: "器件替代", versionFrom: "A", versionTo: "B", status: "PENDING", ecrId, createdBy: users.engineer },
    });
    await prisma.changeImpact.create({
      data: { id: id("impact"), ecoId, entityType: "BOM_ITEM", entityId: id("bom-delayed"), note: "替代关键器件" },
    });
    await prisma.approvalRecord.create({
      data: { id: id("approval"), targetType: "ECO", targetId: ecoId, approverId: users.pm, action: "SUBMIT", comment: "待评审" },
    });
    await prisma.document.create({
      data: {
        id: visibleDocumentId,
        projectId,
        title: "阶段 2 项目文档",
        category: "调试笔记",
        createdBy: users.engineer,
        versions: { create: { id: id("version-visible"), version: 1, contentMd: `# 项目验证\n\n${needle} 项目证据。`, createdBy: users.engineer } },
      },
    });
    await prisma.document.create({
      data: {
        id: sharedDocumentId,
        projectId: null,
        title: "阶段 2 公共文档",
        category: "设计规范",
        createdBy: users.admin,
        versions: { create: { id: id("version-shared"), version: 1, contentMd: `# 公共验证\n\n${needle} 公共证据。`, createdBy: users.admin } },
      },
    });
    await prisma.document.create({
      data: {
        id: hiddenDocumentId,
        projectId: hiddenProjectId,
        title: "阶段 2 隐藏文档",
        category: "失效分析",
        createdBy: users.admin,
        versions: { create: { id: id("version-hidden"), version: 1, contentMd: `# 隐藏验证\n\n${needle} 不得泄露。`, createdBy: users.admin } },
      },
    });

    const backfill = await backfillKnowledgeIndex({ batchSize: 100 });
    assertCondition(backfill.documents === 3 && backfill.chunks >= 3, "阶段 2 Tool 回归夹具未建立阶段 5 文档片段索引");

    for (const [roleName, userId] of Object.entries({
      admin: users.admin,
      pm: users.pm,
      engineer: users.engineer,
      viewer: users.viewer,
      outsider: users.outsider,
      inactive: users.inactive,
    })) {
      const runId = id(`run-${roleName}`);
      runIds.set(roleName, runId);
      await prisma.agentRun.create({ data: { id: runId, userId, sessionId: id(`session-${roleName}`), status: "RUNNING" } });
    }

    const before = await businessSnapshot();
    const gateway = createProductionToolGateway({ cursorSecret: "phase-2-isolated-database-cursor-secret-32-bytes", clock: () => new Date(NOW) });
    const inputByTool: Partial<Record<ToolName, Record<string, unknown>>> = {
      plm_project_resolve: { query: projectCode },
      plm_project_get_summary: { projectId },
      plm_task_list: { projectId, limit: 10 },
      plm_task_get_dependencies: { taskId: taskBlockedId, direction: "both", depth: 2 },
      plm_milestone_list: { projectId, limit: 10 },
      plm_bom_get_risks: { projectId, limit: 10 },
      plm_change_get_impact: { changeRef: ecoNumber, changeType: "ECO" },
      plm_document_search: { query: needle, projectId, includeShared: true, retrievalMode: "lexical", limit: 10 },
      plm_org_get_tree: {},
      plm_org_list_members: {},
      plm_member_get_workload: {},
      plm_report_generate_weekly: {},
    };
    const roleUsers = { admin: users.admin, pm: users.pm, engineer: users.engineer, viewer: users.viewer } as const;
    let requestCounter = 0;
    for (const [roleName, userId] of Object.entries(roleUsers)) {
      for (const tool of TOOL_NAMES) {
        requestCounter += 1;
        const executionContext: ToolExecutionContext = {
          runId: runIds.get(roleName)!,
          traceId: id(`trace-${requestCounter}`),
          requestId: id(`request-${requestCounter}`),
          sessionSubject: userId,
          issuedAt: "2026-08-12T03:59:00.000Z",
          expiresAt: "2026-08-12T05:00:00.000Z",
          locale: "zh-CN",
          timezone: "Asia/Shanghai",
        };
        const result = (await gateway.invoke(tool, inputByTool[tool] ?? {}, executionContext)) as Record<string, any>;
        assertCondition(result.ok === true, `${roleName}/${tool} 未成功：${JSON.stringify(result)}`);
        assertCondition(
          result.scope.projectIds.every((resultProjectId: string) => resultProjectId === projectId),
          `${roleName}/${tool} 返回了越权项目`,
        );
      }
      console.log(`[agent-tool-db] 四角色矩阵：${roleName} 8/8 通过`);
    }

    const outsiderContext = (requestId: string): ToolExecutionContext => ({
      runId: runIds.get("outsider")!,
      traceId: id(`trace-${requestId}`),
      requestId: id(`request-${requestId}`),
      sessionSubject: users.outsider,
      issuedAt: "2026-08-12T03:59:00.000Z",
      expiresAt: "2026-08-12T05:00:00.000Z",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
    });
    const denied = (await gateway.invoke(
      "plm_project_get_summary",
      { projectId },
      outsiderContext("outsider-denied"),
    )) as Record<string, any>;
    assertCondition(denied.ok === false && denied.error.code === "resource_not_accessible", "非成员项目摘要未被拒绝");

    const hiddenResolution = (await gateway.invoke(
      "plm_project_resolve",
      { query: projectCode },
      outsiderContext("outsider-resolve"),
    )) as Record<string, any>;
    assertCondition(hiddenResolution.ok === true && hiddenResolution.data.resolution === "not_found", "项目解析泄露了非成员项目");

    const outsiderDocuments = (await gateway.invoke(
      "plm_document_search",
      { query: needle, includeShared: true, retrievalMode: "lexical", limit: 10 },
      outsiderContext("outsider-docs"),
    )) as Record<string, any>;
    assertCondition(outsiderDocuments.ok === true, "非成员公共文档检索失败");
    assertCondition(
      outsiderDocuments.data.items.length === 1 && outsiderDocuments.data.items[0].documentId === sharedDocumentId,
      "非成员文档检索泄露了项目文档或遗漏公共文档",
    );
    console.log("[agent-tool-db] 非成员边界：摘要拒绝、项目不可枚举、仅公共文档可见");

    const inactiveResult = (await gateway.invoke(
      "plm_project_get_summary",
      { projectId },
      {
        ...outsiderContext("inactive-user"),
        runId: runIds.get("inactive")!,
        sessionSubject: users.inactive,
      },
    )) as Record<string, any>;
    assertCondition(inactiveResult.ok === false && inactiveResult.error.code === "auth_required", "已停用用户未被拒绝");

    await prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId: users.viewer } } });
    const revokedResult = (await gateway.invoke(
      "plm_document_search",
      { query: needle, projectId, includeShared: false, retrievalMode: "lexical", limit: 10 },
      {
        ...outsiderContext("revoked-viewer"),
        runId: runIds.get("viewer")!,
        sessionSubject: users.viewer,
      },
    )) as Record<string, any>;
    assertCondition(
      revokedResult.ok === false && revokedResult.error.code === "resource_not_accessible",
      "项目成员权限撤销后仍可检索项目文档",
    );
    await prisma.projectMember.create({ data: { projectId, userId: users.viewer, roleId: roles.viewer } });
    console.log("[agent-tool-db] 动态鉴权：停用账号和撤销项目成员关系均立即生效");

    const after = await businessSnapshot();
    assertCondition(after === before, "运行只读 Tool 后业务表快照发生变化");
    const toolAuditCount = await prisma.agentToolExecution.count({ where: { runId: { in: Array.from(runIds.values()) } } });
    assertCondition(toolAuditCount === 37, `预期 37 条 Tool 审计，实际 ${toolAuditCount}`);
    const rawInputStored = await prisma.agentToolExecution.count({
      where: { runId: { in: Array.from(runIds.values()) }, inputSummaryJson: { path: ["rawInputStored"], equals: true } },
    });
    assertCondition(rawInputStored === 0, "Tool 审计错误保存了原始输入标记");
    console.log("[agent-tool-db] 无副作用：业务表快照一致；Agent Tool 审计 37/37，原始输入未保存");
    console.log("[agent-tool-db] 阶段 2 PostgreSQL 集成验收通过");
  } finally {
    const runIdValues = Array.from(runIds.values());
    if (runIdValues.length) await prisma.agentRun.deleteMany({ where: { id: { in: runIdValues } } }).catch(() => undefined);
    await prisma.document.deleteMany({ where: { id: { in: [visibleDocumentId, sharedDocumentId, hiddenDocumentId] } } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: { in: [projectId, hiddenProjectId] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } }).catch(() => undefined);
    await prisma.role.deleteMany({ where: { id: { in: Object.values(roles) } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[agent-tool-db] 失败", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
