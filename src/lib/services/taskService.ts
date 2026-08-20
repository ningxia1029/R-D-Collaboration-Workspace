// 任务服务：状态机、依赖环检测、批量更新
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import type { Prisma } from "@prisma/client";
import { writeActivityEvent } from "@/lib/agent/activity";

type TaskDb = Prisma.TransactionClient | typeof prisma;
const TASK_MUTABLE_FIELDS = ["title", "description", "status", "priority", "phaseId", "assigneeId", "parentId", "ecoId", "estimatedHours", "isMilestone", "sortOrder"];

function buildTaskPatch(data: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const field of TASK_MUTABLE_FIELDS) if (field in data) patch[field] = data[field];
  if ("startDate" in data) {
    const value = data.startDate ? new Date(data.startDate as string) : null;
    if (value && Number.isNaN(value.getTime())) throw new ApiError(400, "开始日期无效");
    patch.startDate = value;
  }
  if ("dueDate" in data) {
    const value = data.dueDate ? new Date(data.dueDate as string) : null;
    if (value && Number.isNaN(value.getTime())) throw new ApiError(400, "截止日期无效");
    patch.dueDate = value;
  }
  return patch;
}

async function validateTaskReferences(db: TaskDb, projectId: string, data: Record<string, unknown>, taskId?: string) {
  if (data.phaseId) {
    const phase = await db.phase.findUnique({ where: { id: String(data.phaseId) }, select: { projectId: true } });
    if (!phase || phase.projectId !== projectId) throw new ApiError(400, "阶段不存在或不属于当前项目");
  }
  if (data.ecoId) {
    const eco = await db.changeLog.findUnique({ where: { id: String(data.ecoId) }, select: { projectId: true } });
    if (!eco || eco.projectId !== projectId) throw new ApiError(400, "ECO 不存在或不属于当前项目");
  }
  if (data.assigneeId) {
    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: String(data.assigneeId) } },
      include: { user: { select: { status: true } } },
    });
    if (!member || member.user.status !== "active") throw new ApiError(400, "负责人不是当前项目的有效成员");
  }
  if (data.parentId) {
    let cursor: string | null = String(data.parentId);
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === taskId || visited.has(cursor)) throw new ApiError(400, "父任务关系会形成循环");
      visited.add(cursor);
      const parent: { projectId: string; parentId: string | null } | null = await db.task.findUnique({
        where: { id: cursor }, select: { projectId: true, parentId: true },
      });
      if (!parent || parent.projectId !== projectId) throw new ApiError(400, "父任务不存在或跨项目");
      cursor = parent.parentId;
    }
  }
}

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
  await validateTaskReferences(prisma, data.projectId, data as Record<string, unknown>);
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
  if (data.status && !TASK_STATUSES.includes(data.status as TaskStatus)) {
    throw new ApiError(400, `非法任务状态：${data.status}`);
  }
  const patch = buildTaskPatch(data);
  const task = await prisma.$transaction(async (tx) => {
    const before = await tx.task.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "任务不存在");
    if (opts?.onlyOwn && before.assigneeId !== userId && before.createdBy !== userId) {
      throw new ApiError(403, "只能修改自己负责的任务");
    }
    await validateTaskReferences(tx, before.projectId, data, id);
    const updated = await tx.task.update({ where: { id }, data: patch, include: taskInclude });
    await writeAudit({
      userId, action: "status" in patch ? "STATUS_CHANGE" : "UPDATE", entityType: "TASK", entityId: id,
      diff: { before: { status: before.status, title: before.title }, after: patch },
    }, tx);
    if ("status" in patch && updated.status !== before.status) {
      await writeActivityEvent(tx, {
        projectId: updated.projectId,
        actorUserId: userId,
        eventType: updated.status === "Done" ? "task.completed" : "task.status_changed",
        entityType: "TASK",
        entityId: updated.id,
        payload: {
          title: updated.title,
          statusFrom: before.status,
          statusTo: updated.status,
          assigneeName: updated.assignee?.name ?? null,
        },
      });
    }
    return updated;
  });
  await indexEntity({ entityType: "TASK", entityId: task.id, projectId: task.projectId, title: task.title, body: task.description });
  return task;
}

export async function batchUpdateTasks(userId: string, ids: string[], patch: Record<string, unknown>) {
  if (!ids.length) throw new ApiError(400, "未选择任务");
  if (patch.status && !TASK_STATUSES.includes(patch.status as TaskStatus)) throw new ApiError(400, `非法任务状态：${patch.status}`);
  const data = buildTaskPatch(patch);
  const results = await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({ where: { id: { in: ids } } });
    if (tasks.length !== new Set(ids).size) throw new ApiError(400, "任务列表包含不存在的任务");
    const projectIds = new Set(tasks.map((task) => task.projectId));
    if (projectIds.size !== 1) throw new ApiError(400, "禁止跨项目批量更新任务");
    const projectId = tasks[0].projectId;
    await validateTaskReferences(tx, projectId, patch);
    const updated = [];
    for (const before of tasks) {
      updated.push(await tx.task.update({ where: { id: before.id }, data, include: taskInclude }));
      await writeAudit({
        userId, action: "status" in data ? "STATUS_CHANGE" : "UPDATE", entityType: "TASK", entityId: before.id,
        diff: { before: { status: before.status, title: before.title }, after: data },
      }, tx);
      const current = updated.at(-1)!;
      if ("status" in data && current.status !== before.status) {
        await writeActivityEvent(tx, {
          projectId: current.projectId,
          actorUserId: userId,
          eventType: current.status === "Done" ? "task.completed" : "task.status_changed",
          entityType: "TASK",
          entityId: current.id,
          payload: {
            title: current.title,
            statusFrom: before.status,
            statusTo: current.status,
            assigneeName: current.assignee?.name ?? null,
          },
        });
      }
    }
    return updated;
  });
  for (const task of results) await indexEntity({ entityType: "TASK", entityId: task.id, projectId: task.projectId, title: task.title, body: task.description });
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
