// 任务服务：状态机、依赖环检测、批量更新
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants";

export const taskInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  phase: { select: { id: true, phaseName: true } },
  eco: { select: { id: true, ecoNumber: true } },
  links: true,
} as const;

export async function listTasks(projectId: string, filters?: {
  status?: string; priority?: string; phaseId?: string; assigneeId?: string; q?: string;
}) {
  return prisma.task.findMany({
    where: {
      projectId,
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.priority ? { priority: filters.priority } : {}),
      ...(filters?.phaseId ? { phaseId: filters.phaseId } : {}),
      ...(filters?.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters?.q ? { title: { contains: filters.q } } : {}),
    },
    include: taskInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createTask(userId: string, data: {
  projectId: string; title: string; description?: string; priority?: string;
  phaseId?: string | null; assigneeId?: string | null; parentId?: string | null;
  startDate?: string | null; dueDate?: string | null; estimatedHours?: number | null;
  isMilestone?: boolean; ecoId?: string | null;
}) {
  if (data.parentId) {
    const parent = await prisma.task.findUnique({ where: { id: data.parentId } });
    if (!parent || parent.projectId !== data.projectId) throw new ApiError(400, "父任务不存在或跨项目");
  }
  const task = await prisma.task.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority ?? "P2",
      phaseId: data.phaseId ?? null,
      assigneeId: data.assigneeId ?? null,
      parentId: data.parentId ?? null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      estimatedHours: data.estimatedHours ?? null,
      isMilestone: data.isMilestone ?? false,
      ecoId: data.ecoId ?? null,
      createdBy: userId,
    },
    include: taskInclude,
  });
  await writeAudit({ userId, action: "CREATE", entityType: "TASK", entityId: task.id, diff: { title: task.title } });
  await indexEntity({ entityType: "TASK", entityId: task.id, projectId: task.projectId, title: task.title, body: task.description });
  return task;
}

export async function updateTask(userId: string, id: string, data: Record<string, unknown>, opts?: { onlyOwn?: boolean }) {
  const before = await prisma.task.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "任务不存在");
  if (opts?.onlyOwn && before.assigneeId !== userId && before.createdBy !== userId) {
    throw new ApiError(403, "只能修改自己负责的任务");
  }
  if (data.status && !TASK_STATUSES.includes(data.status as TaskStatus)) {
    throw new ApiError(400, `非法任务状态：${data.status}`);
  }
  const patch: Record<string, unknown> = {};
  const fields = ["title", "description", "status", "priority", "phaseId", "assigneeId", "parentId", "ecoId", "estimatedHours", "isMilestone", "sortOrder"];
  for (const f of fields) if (f in data) patch[f] = data[f];
  if ("startDate" in data) patch.startDate = data.startDate ? new Date(data.startDate as string) : null;
  if ("dueDate" in data) patch.dueDate = data.dueDate ? new Date(data.dueDate as string) : null;

  const task = await prisma.task.update({ where: { id }, data: patch, include: taskInclude });
  await writeAudit({
    userId, action: "status" in patch ? "STATUS_CHANGE" : "UPDATE", entityType: "TASK", entityId: id,
    diff: { before: { status: before.status, title: before.title }, after: patch },
  });
  await indexEntity({ entityType: "TASK", entityId: task.id, projectId: task.projectId, title: task.title, body: task.description });
  return task;
}

export async function batchUpdateTasks(userId: string, ids: string[], patch: Record<string, unknown>) {
  if (!ids.length) throw new ApiError(400, "未选择任务");
  const results = [];
  for (const id of ids) {
    results.push(await updateTask(userId, id, patch));
  }
  return results;
}

export async function deleteTask(userId: string, id: string) {
  const before = await prisma.task.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "任务不存在");
  await prisma.task.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "TASK", entityId: id, diff: { title: before.title } });
  await removeFromIndex("TASK", id);
}

/** 依赖环检测：沿 successor 方向 DFS，加入 predecessor→successor 后是否成环 */
async function wouldCreateCycle(predecessorId: string, successorId: string): Promise<string[] | null> {
  const deps = await prisma.taskDependency.findMany();
  const adj = new Map<string, string[]>();
  for (const d of deps) {
    if (!adj.has(d.predecessorId)) adj.set(d.predecessorId, []);
    adj.get(d.predecessorId)!.push(d.successorId);
  }
  // 若 successor 可达 predecessor，则成环
  const path: string[] = [];
  const visited = new Set<string>();
  const dfs = (node: string, target: string): boolean => {
    if (node === target) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    path.push(node);
    for (const next of adj.get(node) ?? []) {
      if (dfs(next, target)) return true;
    }
    path.pop();
    return false;
  };
  return dfs(successorId, predecessorId) ? [...path, predecessorId] : null;
}

export async function addDependency(userId: string, data: { predecessorId: string; successorId: string; type?: string; lagDays?: number }) {
  const { predecessorId, successorId } = data;
  if (predecessorId === successorId) throw new ApiError(400, "任务不能依赖自身");
  const [pre, suc] = await Promise.all([
    prisma.task.findUnique({ where: { id: predecessorId } }),
    prisma.task.findUnique({ where: { id: successorId } }),
  ]);
  if (!pre || !suc) throw new ApiError(404, "任务不存在");
  if (pre.projectId !== suc.projectId) throw new ApiError(400, "依赖任务必须属于同一项目");

  const cycle = await wouldCreateCycle(predecessorId, successorId);
  if (cycle) {
    const titles = await prisma.task.findMany({ where: { id: { in: cycle } }, select: { title: true } });
    throw new ApiError(409, `依赖将形成环：${titles.map((x) => x.title).join(" → ")}`);
  }
  const dep = await prisma.taskDependency.create({
    data: { predecessorId, successorId, type: data.type ?? "FS", lagDays: data.lagDays ?? 0 },
  });

  // FS 冲突提示：后继开始早于前置完成
  let conflict = false;
  if (pre.dueDate && suc.startDate && suc.startDate < pre.dueDate) conflict = true;
  await writeAudit({ userId, action: "CREATE", entityType: "TASK_DEPENDENCY", entityId: dep.id, diff: { pre: pre.title, suc: suc.title } });
  return { ...dep, conflict };
}

export async function removeDependency(userId: string, id: string) {
  await prisma.taskDependency.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "TASK_DEPENDENCY", entityId: id });
}

/** 甘特数据：任务 + 依赖 + 里程碑 + 阶段 */
export async function getGanttData(projectId: string) {
  const [tasks, dependencies, milestones, phases] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: [{ startDate: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } } }),
    prisma.milestone.findMany({ where: { projectId }, orderBy: { date: "asc" } }),
    prisma.phase.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
  ]);
  return { tasks, dependencies, milestones, phases };
}
