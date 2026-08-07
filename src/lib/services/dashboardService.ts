// Dashboard 聚合统计服务
import { prisma } from "@/lib/prisma";
import { visibleProjectIds, type SessionUser } from "@/lib/rbac";

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

export async function getDashboardSummary(user: SessionUser) {
  const ids = await visibleProjectIds(user);
  const pidFilter = ids === null ? {} : { projectId: { in: ids } };
  const idFilter = ids === null ? {} : { id: { in: ids } };

  const [
    activeProjects,
    todoTasks,
    blockedTasks,
    delayedBom,
    recentEcos,
    projects,
    upcomingTasks,
    upcomingBoms,
    upcomingPhases,
    ecosByType,
    ecosByStatus,
    docsCount,
    docsRecent,
  ] = await Promise.all([
    prisma.project.count({ where: { ...idFilter, status: "active" } }),
    prisma.task.count({ where: { ...pidFilter, status: { in: ["To Do", "In Progress", "Testing"] } } }),
    prisma.task.count({ where: { ...pidFilter, status: "Blocked" } }),
    prisma.bomItem.count({ where: { ...pidFilter, status: "Delayed" } }),
    prisma.changeLog.count({ where: { ...pidFilter, createdAt: { gte: daysFromNow(-7) } } }),
    prisma.project.findMany({
      where: { ...idFilter, status: "active" },
      include: { owner: { select: { name: true } }, _count: { select: { tasks: true } } },
    }),
    prisma.task.findMany({
      where: { ...pidFilter, status: { not: "Done" }, dueDate: { gte: new Date(), lte: daysFromNow(14) } },
      include: { project: { select: { name: true, code: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
    prisma.bomItem.findMany({
      where: { ...pidFilter, status: { notIn: ["Arrived"] }, eta: { gte: new Date(), lte: daysFromNow(14) } },
      include: { project: { select: { name: true, code: true } } },
      orderBy: { eta: "asc" },
      take: 20,
    }),
    prisma.phase.findMany({
      where: { ...(ids === null ? {} : { projectId: { in: ids } }), status: { not: "done" }, targetDate: { gte: new Date(), lte: daysFromNow(14) } },
      include: { project: { select: { name: true, code: true } } },
      orderBy: { targetDate: "asc" },
      take: 20,
    }),
    prisma.changeLog.groupBy({ by: ["type"], where: pidFilter, _count: { _all: true } }),
    prisma.changeLog.groupBy({ by: ["status"], where: pidFilter, _count: { _all: true } }),
    prisma.document.count(),
    prisma.document.count({ where: { updatedAt: { gte: daysFromNow(-7) } } }),
  ]);

  // 项目健康度：任务完成率 + 是否有 Blocked / Delayed
  const health = await Promise.all(
    projects.map(async (p) => {
      const [done, blocked, delayed, overdueTasks] = await Promise.all([
        prisma.task.count({ where: { projectId: p.id, status: "Done" } }),
        prisma.task.count({ where: { projectId: p.id, status: "Blocked" } }),
        prisma.bomItem.count({ where: { projectId: p.id, status: "Delayed" } }),
        prisma.task.count({ where: { projectId: p.id, status: { not: "Done" }, dueDate: { lt: new Date() } } }),
      ]);
      const total = p._count.tasks;
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      const level = blocked > 0 || overdueTasks > 0 ? "red" : delayed > 0 ? "yellow" : "green";
      return { ...p, progress, blocked, delayed, overdueTasks, healthLevel: level };
    })
  );

  // 临近 Deadline 时间轴（14 天聚合）
  const deadlines = [
    ...upcomingTasks.map((x) => ({ type: "TASK" as const, id: x.id, title: x.title, date: x.dueDate!, project: x.project.code, status: x.status })),
    ...upcomingBoms.map((x) => ({ type: "BOM" as const, id: x.id, title: `${x.mpn} ${x.name} 到货`, date: x.eta!, project: x.project.code, status: x.status })),
    ...upcomingPhases.map((x) => ({ type: "PHASE" as const, id: x.id, title: `${x.phaseName} 阶段节点`, date: x.targetDate!, project: x.project.code, status: x.status })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    cards: { activeProjects, todoTasks, blockedTasks, delayedBom, recentEcos, docsCount, docsRecent },
    health,
    deadlines,
    ecoStats: {
      byType: Object.fromEntries(ecosByType.map((r) => [r.type, r._count._all])),
      byStatus: Object.fromEntries(ecosByStatus.map((r) => [r.status, r._count._all])),
    },
  };
}

/** 资源负载：按成员聚合 预估工时 vs 已登记工时 */
export async function getWorkload(user: SessionUser, projectId?: string) {
  const ids = await visibleProjectIds(user);
  const pidFilter = projectId ? { projectId } : ids === null ? {} : { projectId: { in: ids } };

  const tasks = await prisma.task.findMany({
    where: { ...pidFilter, assigneeId: { not: null }, status: { not: "Done" } },
    select: { assigneeId: true, estimatedHours: true },
  });
  const entries = await prisma.timeEntry.findMany({
    where: { task: pidFilter },
    select: { userId: true, hours: true },
  });

  const estimated = new Map<string, number>();
  for (const t of tasks) estimated.set(t.assigneeId!, (estimated.get(t.assigneeId!) ?? 0) + (t.estimatedHours ?? 0));
  const logged = new Map<string, number>();
  for (const e of entries) logged.set(e.userId, (logged.get(e.userId) ?? 0) + e.hours);

  const userIds = [...new Set([...estimated.keys(), ...logged.keys()])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  return users.map((u) => ({
    user: u,
    estimatedHours: Math.round((estimated.get(u.id) ?? 0) * 10) / 10,
    loggedHours: Math.round((logged.get(u.id) ?? 0) * 10) / 10,
    openTasks: tasks.filter((t) => t.assigneeId === u.id).length,
  }));
}
