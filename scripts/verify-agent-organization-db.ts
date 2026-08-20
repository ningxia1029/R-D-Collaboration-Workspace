import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { ToolExecutionContext } from "../src/lib/agent/tools/contracts";
import { createProductionToolGateway } from "../src/lib/agent/tools/production";
import { getWorkload } from "../src/lib/services/dashboardService";
import { updateMemberOrganization, updateOrgUnit } from "../src/lib/services/organizationService";
import { createResourcePlan, updateResourcePlan } from "../src/lib/services/resourcePlanService";
import type { SessionUser } from "../src/lib/rbac";

const prisma = new PrismaClient({ errorFormat: "minimal" });
const NOW = new Date("2026-08-13T04:00:00.000Z");
const CURSOR_SECRET = "phase-six-isolated-organization-cursor-secret";

function requireIsolatedTarget(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL；拒绝猜测阶段 6 验收库");
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^(postgresql|postgres):$/.test(parsed.protocol) || parsed.hostname !== "127.0.0.1") {
    throw new Error("阶段 6 验收只允许 127.0.0.1 PostgreSQL 隔离库");
  }
  if (process.env.AGENT_ORG_VERIFY_TARGET_ACK !== databaseName) throw new Error("AGENT_ORG_VERIFY_TARGET_ACK 必须与数据库名完全一致");
  if (process.env.AGENT_ORG_VERIFY_ALLOW_DESTRUCTIVE !== "1") throw new Error("必须显式确认可丢弃隔离库");
  if (!/^workbuddy_phase6_[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error("数据库名不符合阶段 6 隔离命名规则");
  return databaseName;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectFailure(action: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label} 未按预期失败`);
}

function asResult(value: unknown): Record<string, any> {
  return value as Record<string, any>;
}

async function businessSnapshot(): Promise<string> {
  const [orgs, positions, users, projects, members, tasks, entries, windows, allocations] = await Promise.all([
    prisma.orgUnit.findMany({ orderBy: { id: "asc" } }),
    prisma.position.findMany({ orderBy: { id: "asc" } }),
    prisma.user.findMany({ orderBy: { id: "asc" } }),
    prisma.project.findMany({ orderBy: { id: "asc" } }),
    prisma.projectMember.findMany({ orderBy: [{ projectId: "asc" }, { userId: "asc" }] }),
    prisma.task.findMany({ orderBy: { id: "asc" } }),
    prisma.timeEntry.findMany({ orderBy: { id: "asc" } }),
    prisma.resourcePlanWindow.findMany({ orderBy: { id: "asc" } }),
    prisma.resourcePlanAllocation.findMany({ orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ orgs, positions, users, projects, members, tasks, entries, windows, allocations });
}

async function main() {
  const databaseName = requireIsolatedTarget();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const id = (name: string) => `p6-${name}-${suffix}`;
  const roles = { admin: id("role-admin"), pm: id("role-pm"), engineer: id("role-engineer"), viewer: id("role-viewer") };
  const orgs = { root: id("org-rd"), hardware: id("org-hw"), firmware: id("org-fw"), secret: id("org-secret") };
  const users = { admin: id("user-admin"), manager: id("user-manager"), u1: id("user-u1"), u2: id("user-u2"), u3: id("user-u3"), inactive: id("user-inactive"), outsider: id("user-outsider") };
  const projects = { visible: id("project-visible"), hidden: id("project-hidden") };
  const tasks = { u1a: id("task-u1-a"), u1b: id("task-u1-b"), u2: id("task-u2"), u3: id("task-u3"), hidden: id("task-hidden") };
  const runs = { admin: id("run-admin"), manager: id("run-manager"), u3: id("run-u3") };

  try {
    const version = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    console.log(`[agent-org-db] target=${databaseName} engine=${version[0]?.version.split(",")[0] ?? "unknown"}`);
    await prisma.role.createMany({ data: [
      { id: roles.admin, name: "admin", description: "阶段 6 管理员" },
      { id: roles.pm, name: "pm", description: "阶段 6 项目经理" },
      { id: roles.engineer, name: "engineer", description: "阶段 6 工程师" },
      { id: roles.viewer, name: "viewer", description: "阶段 6 访客" },
    ] });
    await prisma.orgUnit.createMany({ data: [
      { id: orgs.root, code: `RD-${suffix}`, name: "研发中心" },
      { id: orgs.hardware, code: `HW-${suffix}`, name: "硬件组", parentId: orgs.root },
      { id: orgs.firmware, code: `FW-${suffix}`, name: "固件组", parentId: orgs.root },
      { id: orgs.secret, code: `SEC-${suffix}`, name: "隔离事业部" },
    ] });
    const position = await prisma.position.create({ data: { id: id("position-hw"), code: `HWENG-${suffix}`, name: "硬件工程师", orgUnitId: orgs.hardware } });
    const acceptancePasswordHash = await bcrypt.hash("Phase6Acceptance!2026", 10);
    await prisma.user.createMany({ data: [
      { id: users.admin, email: `${users.admin}@invalid.local`, name: "阶段 6 管理员", passwordHash: acceptancePasswordHash, roleId: roles.admin },
      { id: users.manager, email: `${users.manager}@invalid.local`, name: "研发负责人", passwordHash: acceptancePasswordHash, roleId: roles.pm, primaryOrgUnitId: orgs.root, weeklyCapacityHours: 40 },
      { id: users.u1, email: `${users.u1}@invalid.local`, name: "硬件工程师甲", passwordHash: acceptancePasswordHash, roleId: roles.engineer, primaryOrgUnitId: orgs.hardware, positionId: position.id, managerId: users.manager, weeklyCapacityHours: 40 },
      { id: users.u2, email: `${users.u2}@invalid.local`, name: "固件工程师乙", passwordHash: acceptancePasswordHash, roleId: roles.engineer, primaryOrgUnitId: orgs.firmware, managerId: users.manager, weeklyCapacityHours: null },
      { id: users.u3, email: `${users.u3}@invalid.local`, name: "观察成员丙", passwordHash: acceptancePasswordHash, roleId: roles.viewer, primaryOrgUnitId: orgs.hardware, managerId: users.manager, weeklyCapacityHours: 40 },
      { id: users.inactive, email: `${users.inactive}@invalid.local`, name: "停用成员", passwordHash: acceptancePasswordHash, roleId: roles.engineer, status: "disabled", primaryOrgUnitId: orgs.hardware },
      { id: users.outsider, email: `${users.outsider}@invalid.local`, name: "隔离成员", passwordHash: acceptancePasswordHash, roleId: roles.pm, primaryOrgUnitId: orgs.secret, weeklyCapacityHours: 40 },
    ] });
    await prisma.orgUnit.update({ where: { id: orgs.root }, data: { managerId: users.manager } });
    await prisma.project.createMany({ data: [
      { id: projects.visible, code: `P6-${suffix}`, name: "阶段 6 可见项目", ownerId: users.manager },
      { id: projects.hidden, code: `H6-${suffix}`, name: "阶段 6 隐藏项目", ownerId: users.outsider },
    ] });
    await prisma.projectMember.createMany({ data: [
      { projectId: projects.visible, userId: users.manager, roleId: roles.pm },
      { projectId: projects.visible, userId: users.u1, roleId: roles.engineer },
      { projectId: projects.visible, userId: users.u2, roleId: roles.engineer },
      { projectId: projects.visible, userId: users.u3, roleId: roles.viewer },
      { projectId: projects.hidden, userId: users.outsider, roleId: roles.pm },
    ] });
    await prisma.task.createMany({ data: [
      { id: tasks.u1a, projectId: projects.visible, title: "原理图评审", status: "In Progress", priority: "P1", assigneeId: users.u1, estimatedHours: 8 },
      { id: tasks.u1b, projectId: projects.visible, title: "硬件联调", status: "Blocked", priority: "P0", assigneeId: users.u1, estimatedHours: 12 },
      { id: tasks.u2, projectId: projects.visible, title: "固件开发", status: "To Do", priority: "P2", assigneeId: users.u2, estimatedHours: 7 },
      { id: tasks.u3, projectId: projects.visible, title: "文档复核", status: "Testing", priority: "P3", assigneeId: users.u3, estimatedHours: 5 },
      { id: tasks.hidden, projectId: projects.hidden, title: "隔离任务", status: "In Progress", priority: "P1", assigneeId: users.outsider, estimatedHours: 9 },
    ] });
    await prisma.timeEntry.createMany({ data: [
      { id: id("entry-start"), taskId: tasks.u1a, userId: users.u1, date: new Date("2026-08-09T16:00:00.000Z"), hours: 2 },
      { id: id("entry-end-minus"), taskId: tasks.u1b, userId: users.u1, date: new Date("2026-08-14T15:59:59.000Z"), hours: 4 },
      { id: id("entry-end"), taskId: tasks.u1b, userId: users.u1, date: new Date("2026-08-14T16:00:00.000Z"), hours: 10 },
      { id: id("entry-u3"), taskId: tasks.u3, userId: users.u3, date: new Date("2026-08-11T02:00:00.000Z"), hours: 1 },
    ] });
    await prisma.agentRun.createMany({ data: [
      { id: runs.admin, userId: users.admin, sessionId: id("session-admin"), status: "RUNNING" },
      { id: runs.manager, userId: users.manager, sessionId: id("session-manager"), status: "RUNNING" },
      { id: runs.u3, userId: users.u3, sessionId: id("session-u3"), status: "RUNNING" },
    ] });

    const adminSession: SessionUser = { id: users.admin, email: `${users.admin}@invalid.local`, name: "阶段 6 管理员", roleId: roles.admin, roleName: "admin" };
    const managerSession: SessionUser = { id: users.manager, email: `${users.manager}@invalid.local`, name: "研发负责人", roleId: roles.pm, roleName: "pm" };
    const viewerSession: SessionUser = { id: users.u3, email: `${users.u3}@invalid.local`, name: "观察成员丙", roleId: roles.viewer, roleName: "viewer" };

    const u1Draft = await createResourcePlan(adminSession, {
      userId: users.u1, dateFrom: "2026-08-10", dateTo: "2026-08-16",
      allocations: [
        { taskId: tasks.u1a, date: "2026-08-10", hours: 10 },
        { taskId: tasks.u1b, date: "2026-08-11", hours: 20 },
      ],
    });
    await updateResourcePlan(adminSession, { id: u1Draft.id, action: "publish" });
    const u3Draft = await createResourcePlan(adminSession, { userId: users.u3, dateFrom: "2026-08-10", dateTo: "2026-08-16", allocations: [] });
    await updateResourcePlan(adminSession, { id: u3Draft.id, action: "publish" });

    await expectFailure(() => updateOrgUnit({ id: orgs.root, parentId: orgs.hardware }), "组织循环");
    await expectFailure(() => updateMemberOrganization({ userId: users.u1, managerId: users.u1 }), "自我经理");
    await expectFailure(() => updateMemberOrganization({ userId: users.u2, positionId: position.id }), "跨部门岗位");
    await expectFailure(() => prisma.resourcePlanWindow.create({
      data: { id: id("overlap-window"), userId: users.u1, dateFrom: new Date("2026-08-12T00:00:00Z"), dateTo: new Date("2026-08-18T00:00:00Z"), status: "published", createdBy: users.admin },
    }), "发布窗口重叠");
    await expectFailure(() => prisma.resourcePlanAllocation.create({
      data: { id: id("outside-allocation"), planWindowId: u1Draft.id, taskId: tasks.u1a, date: new Date("2026-08-17T00:00:00Z"), hours: 1 },
    }), "窗口外计划分配");
    console.log("[agent-org-db] 写入约束：组织环、自管理、跨部门岗位、窗口重叠与窗口外分配均被拒绝");

    const beforeTools = await businessSnapshot();
    const gateway = createProductionToolGateway({ cursorSecret: CURSOR_SECRET, clock: () => new Date(NOW) });
    let requestSequence = 0;
    const context = (actor: keyof typeof runs): ToolExecutionContext => ({
      runId: runs[actor],
      traceId: `trace-p6-${++requestSequence}`,
      requestId: `request-p6-${requestSequence}`,
      sessionSubject: users[actor],
      issuedAt: "2026-08-13T03:59:00.000Z",
      expiresAt: "2026-08-13T05:00:00.000Z",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
    });

    const managerTree = asResult(await gateway.invoke("plm_org_get_tree", { rootOrgUnitId: orgs.root, depth: 3 }, context("manager")));
    assertCondition(managerTree.ok && managerTree.data.nodes.length === 3, "负责人未看到授权组织子树");
    assertCondition(!JSON.stringify(managerTree).includes("@invalid.local"), "组织树泄露邮箱");
    const viewerTree = asResult(await gateway.invoke("plm_org_get_tree", {}, context("u3")));
    assertCondition(viewerTree.ok && viewerTree.data.nodes.length === 1 && viewerTree.data.nodes[0].id === orgs.hardware, "普通成员组织范围不正确");
    const membersResult = asResult(await gateway.invoke("plm_org_list_members", { orgUnitId: orgs.hardware, limit: 20 }, context("u3")));
    assertCondition(membersResult.ok && membersResult.data.items.some((row: any) => row.status === "inactive"), "停用成员状态未安全映射");
    assertCondition(!JSON.stringify(membersResult.data).includes("email"), "组织成员 Tool 返回了邮箱字段");
    const hiddenOrg = asResult(await gateway.invoke("plm_org_list_members", { orgUnitId: orgs.secret }, context("u3")));
    assertCondition(!hiddenOrg.ok && hiddenOrg.error.code === "resource_not_accessible", "普通成员越权读取隔离组织");

    const orgWorkload = asResult(await gateway.invoke("plm_member_get_workload", {
      scope: { type: "org_unit", orgUnitId: orgs.root, recursive: true },
      projectId: projects.visible,
      dateFrom: "2026-08-10",
      dateTo: "2026-08-14",
      includeTaskDetails: true,
    }, context("manager")));
    assertCondition(orgWorkload.ok, "负责人组织负载查询失败");
    const u1 = orgWorkload.data.members.find((row: any) => row.userId === users.u1);
    const u2 = orgWorkload.data.members.find((row: any) => row.userId === users.u2);
    const u3 = orgWorkload.data.members.find((row: any) => row.userId === users.u3);
    assertCondition(u1?.openTaskCount === 2 && u1.openEstimatedHours === 20, "开放任务存量聚合不正确");
    assertCondition(u1.loggedHoursInWindow === 6, "Asia/Shanghai 时间窗边界聚合不正确");
    assertCondition(u1.capacityHoursInWindow === 40 && u1.plannedHoursInWindow === 30 && u1.utilizationPercent === 75, "产能/计划/利用率聚合不正确");
    assertCondition(u2?.capacityHoursInWindow === null && u2.plannedHoursInWindow === null && u2.utilizationPercent === null, "缺数据被误算为 0 利用率");
    assertCondition(u2.dataQuality === "insufficient" && u2.missingFields.includes("weekly_capacity_hours") && u2.missingFields.includes("published_plan_window"), "缺失字段解释不完整");
    assertCondition(u3?.plannedHoursInWindow === 0 && u3.utilizationPercent === 0 && u3.dataQuality === "complete", "明确零计划未与缺失计划区分");
    assertCondition(orgWorkload.data.rankingMetric === "open_estimated_hours", "混合质量负载应回退为开放任务存量口径");
    assertCondition(!JSON.stringify(orgWorkload.data).includes("@invalid.local"), "负载 Tool 泄露邮箱");

    const selfWorkload = asResult(await gateway.invoke("plm_member_get_workload", {
      scope: { type: "users", userIds: [users.u3] }, dateFrom: "2026-08-10", dateTo: "2026-08-14",
    }, context("u3")));
    assertCondition(selfWorkload.ok && selfWorkload.scope.permissionsApplied.includes("self_scope"), "time:read 本人范围未生效");
    const peerAttempt = asResult(await gateway.invoke("plm_member_get_workload", {
      scope: { type: "users", userIds: [users.u1] }, dateFrom: "2026-08-10", dateTo: "2026-08-14",
    }, context("u3")));
    assertCondition(!peerAttempt.ok && peerAttempt.error.code === "resource_not_accessible", "time:read 越权读取他人负载");
    const secretAttempt = asResult(await gateway.invoke("plm_member_get_workload", {
      scope: { type: "org_unit", orgUnitId: orgs.secret }, dateFrom: "2026-08-10", dateTo: "2026-08-14",
    }, context("manager")));
    assertCondition(!secretAttempt.ok && secretAttempt.error.code === "resource_not_accessible", "time:read_all 绕过组织范围");
    const hiddenProjectAttempt = asResult(await gateway.invoke("plm_member_get_workload", {
      scope: { type: "project", projectId: projects.hidden }, dateFrom: "2026-08-10", dateTo: "2026-08-14",
    }, context("manager")));
    assertCondition(!hiddenProjectAttempt.ok && hiddenProjectAttempt.error.code === "resource_not_accessible", "time:read_all 绕过项目成员范围");

    const legacyViewer = await getWorkload(viewerSession, projects.visible);
    assertCondition(legacyViewer.length === 1 && legacyViewer[0].user.id === users.u3, "旧资源接口未将 time:read 限制为本人");
    assertCondition(!("email" in legacyViewer[0].user), "旧资源接口仍返回邮箱");
    const legacyManager = await getWorkload(managerSession, projects.visible);
    assertCondition(legacyManager.length >= 3, "time:read_all 未保留项目成员汇总能力");

    const afterTools = await businessSnapshot();
    assertCondition(beforeTools === afterTools, "只读组织/负载 Tool 改写了业务数据");
    const auditCount = await prisma.agentToolExecution.count();
    assertCondition(auditCount === requestSequence, "组织/负载 Tool 审计数量与调用数不一致");
    console.log(`[agent-org-db] Tool：组织范围、项目交集、本人隐私、跨域反例、脱敏和只读快照通过；审计 ${auditCount}/${requestSequence}`);
    console.log("[agent-org-db] 聚合：5 工作日，40h 产能，30h 计划，6h 登记，75% 利用率；缺失=null，发布零计划=0");
    console.log("AGENT_ORGANIZATION_DB_ACCEPTANCE=PASS");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("AGENT_ORGANIZATION_DB_ACCEPTANCE=FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
