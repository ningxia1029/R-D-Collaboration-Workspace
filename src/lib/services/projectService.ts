// 项目服务 + 生命周期阶段机
import { prisma } from "@/lib/prisma";
import { ApiError, type SessionUser } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { LIFECYCLE_STAGES, PROJECT_STATUSES, type LifecycleStage } from "@/lib/constants";
import { getKitRate } from "@/lib/services/bomService";

export async function listProjects(user: SessionUser) {
  const projectScope = user.roleName === "admin"
    ? {}
    : { members: { some: { userId: user.id } } };
  const taskScope = user.roleName === "admin"
    ? {}
    : { project: { members: { some: { userId: user.id } } } };

  // 项目列表与完成任务统计并行查询，避免“成员列表 + 项目 + 每项目一次 count”的 N+1 云数据库往返。
  const [projects, doneRows] = await Promise.all([
    prisma.project.findMany({
      where: projectScope,
      include: {
        owner: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, code: true } },
        _count: { select: { tasks: true, bomItems: true, changeLogs: true, members: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: { ...taskScope, status: "Done" },
      _count: { _all: true },
    }),
  ]);
  const doneByProject = new Map(doneRows.map((row) => [row.projectId, row._count._all]));
  return projects.map((project) => {
    const total = project._count.tasks;
    const done = doneByProject.get(project.id) ?? 0;
    return { ...project, progress: total === 0 ? 0 : Math.round((done / total) * 100) };
  });
}

export async function createProject(userId: string, data: Record<string, unknown>) {
  const project = await prisma.project.create({
    data: {
      name: data.name as string,
      code: data.code as string,
      description: (data.description as string) ?? null,
      ownerId: userId,
      startDate: data.startDate ? new Date(data.startDate as string) : null,
      endDate: data.endDate ? new Date(data.endDate as string) : null,
      productId: (data.productId as string) ?? null,
      members: { create: { userId } },
    },
  });
  // 默认创建 POC 阶段
  await prisma.phase.create({ data: { projectId: project.id, phaseName: "POC", sortOrder: 0, status: "active" } });
  await writeAudit({ userId, action: "CREATE", entityType: "PROJECT", entityId: project.id, diff: { name: project.name } });
  return project;
}

export async function updateProject(userId: string, id: string, data: Record<string, unknown>) {
  if (data.status && !PROJECT_STATUSES.includes(data.status as (typeof PROJECT_STATUSES)[number])) {
    throw new ApiError(400, `非法项目状态：${String(data.status)}`);
  }
  const patch: Record<string, unknown> = {};
  for (const f of ["name", "description", "status", "productId"]) if (f in data) patch[f] = data[f];
  if ("startDate" in data) patch.startDate = data.startDate ? new Date(data.startDate as string) : null;
  if ("endDate" in data) patch.endDate = data.endDate ? new Date(data.endDate as string) : null;
  const project = await prisma.project.update({ where: { id }, data: patch });
  await writeAudit({ userId, action: "UPDATE", entityType: "PROJECT", entityId: id, diff: patch });
  return project;
}

// ==================== 生命周期阶段机 ====================

const STAGE_ORDER: LifecycleStage[] = [...LIFECYCLE_STAGES];

export async function transitionLifecycle(userId: string, projectId: string, toStage: LifecycleStage, comment?: string, force = false) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(404, "项目不存在");
  const from = project.lifecycleStage as LifecycleStage;
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(toStage);
  if (toIdx === fromIdx) throw new ApiError(400, "目标阶段与当前阶段相同");
  if (toIdx > fromIdx + 1) throw new ApiError(400, "不允许跨阶段跳转");
  if (toIdx < fromIdx - 1) throw new ApiError(400, "最多允许回退一级");

  // 守卫规则
  const warnings: string[] = [];
  if (toStage === "PILOT") {
    const activePhase = await prisma.phase.findFirst({ where: { projectId, status: "active" } });
    const kit = await getKitRate(projectId, activePhase?.id ?? null);
    if (kit.rate < 100) warnings.push(`当前阶段 BOM 齐套率仅 ${kit.rate}%，建议齐套后再进入试产`);
  }
  if (toStage === "MP") {
    const p0Open = await prisma.task.count({ where: { projectId, priority: "P0", status: { not: "Done" } } });
    const pendingEco = await prisma.changeLog.count({ where: { projectId, status: "PENDING" } });
    if (p0Open > 0 && !force) throw new ApiError(400, `存在 ${p0Open} 个未完成的 P0 任务，禁止进入量产`);
    if (pendingEco > 0 && !force) throw new ApiError(400, `存在 ${pendingEco} 个待审批的 ECO，禁止进入量产`);
  }
  if (warnings.length && !force) {
    return { warning: true, warnings, project };
  }

  const updated = await prisma.project.update({ where: { id: projectId }, data: { lifecycleStage: toStage } });
  await prisma.approvalRecord.create({
    data: { targetType: "LIFECYCLE", targetId: projectId, approverId: userId, action: "APPROVE", comment: comment ?? `${from} → ${toStage}` },
  });
  await writeAudit({ userId, action: "LIFECYCLE", entityType: "PROJECT", entityId: projectId, diff: { from, to: toStage } });
  return { warning: false, warnings: [], project: updated };
}
