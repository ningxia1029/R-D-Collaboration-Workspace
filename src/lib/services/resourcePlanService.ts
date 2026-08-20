import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, roleHasPerm, type SessionUser } from "@/lib/rbac";
import { managedOrgUnitIds } from "@/lib/services/organizationScope";

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;

export interface ResourcePlanAllocationInput {
  taskId: string;
  date: string;
  hours: number;
}

function dateOnly(value: unknown, field: string): { text: string; value: Date } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, `${field} 必须是 YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ApiError(400, `${field} 不是有效日期`);
  return { text: value, value: parsed };
}

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new ApiError(400, `${field} 格式无效`);
  return value.trim();
}

async function assertCanManagePlan(actor: SessionUser, targetUserId: string): Promise<void> {
  if (actor.roleName === "admin") return;
  if (!roleHasPerm(actor.roleName, "time:read_all")) throw new ApiError(403, "缺少资源计划维护权限");
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { primaryOrgUnitId: true } });
  const managedIds = await managedOrgUnitIds(actor);
  if (!target?.primaryOrgUnitId || managedIds === null || !managedIds.includes(target.primaryOrgUnitId)) {
    throw new ApiError(403, "目标成员不在当前账号负责的组织范围内");
  }
}

function normalizeAllocations(value: unknown): ResourcePlanAllocationInput[] {
  if (!Array.isArray(value) || value.length > 500) throw new ApiError(400, "allocations 必须是最多 500 条的数组");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new ApiError(400, `allocations[${index}] 格式无效`);
    const row = item as Record<string, unknown>;
    const hours = typeof row.hours === "number" ? row.hours : Number.NaN;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new ApiError(400, `allocations[${index}].hours 必须大于 0 且不超过 24`);
    return { taskId: id(row.taskId, `allocations[${index}].taskId`), date: dateOnly(row.date, `allocations[${index}].date`).text, hours };
  });
}

async function validateAllocations(
  tx: Tx,
  targetUserId: string,
  dateFrom: string,
  dateTo: string,
  allocations: readonly ResourcePlanAllocationInput[],
) {
  const uniqueKeys = new Set<string>();
  const dailyHours = new Map<string, number>();
  for (const allocation of allocations) {
    if (allocation.date < dateFrom || allocation.date > dateTo) throw new ApiError(400, "计划分配日期必须位于计划窗口内");
    const key = `${allocation.taskId}:${allocation.date}`;
    if (uniqueKeys.has(key)) throw new ApiError(400, "同一任务同一天不能重复分配");
    uniqueKeys.add(key);
    dailyHours.set(allocation.date, (dailyHours.get(allocation.date) ?? 0) + allocation.hours);
  }
  if ([...dailyHours.values()].some((hours) => hours > 24)) throw new ApiError(400, "单个成员每天计划工时不能超过 24 小时");

  const taskIds = [...new Set(allocations.map((allocation) => allocation.taskId))];
  const tasks = await tx.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, assigneeId: true } });
  if (tasks.length !== taskIds.length || tasks.some((task) => task.assigneeId !== targetUserId)) {
    throw new ApiError(400, "计划中的任务必须存在且当前负责人必须是计划成员");
  }
}

async function lockPlanOwner(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workbuddy:resource-plan:${userId}`}))`;
}

export async function listResourcePlans(actor: SessionUser, requestedUserId?: string) {
  const userId = requestedUserId ? id(requestedUserId, "userId") : actor.id;
  if (userId !== actor.id) await assertCanManagePlan(actor, userId);
  return prisma.resourcePlanWindow.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      dateFrom: true,
      dateTo: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
      allocations: {
        select: { id: true, taskId: true, date: true, hours: true, task: { select: { title: true, projectId: true } } },
        orderBy: [{ date: "asc" }, { taskId: "asc" }],
      },
    },
    orderBy: [{ dateFrom: "desc" }, { id: "asc" }],
  });
}

export async function createResourcePlan(actor: SessionUser, input: Record<string, unknown>) {
  const userId = id(input.userId, "userId");
  await assertCanManagePlan(actor, userId);
  const from = dateOnly(input.dateFrom, "dateFrom");
  const to = dateOnly(input.dateTo, "dateTo");
  const days = Math.floor((to.value.getTime() - from.value.getTime()) / DAY_MS) + 1;
  if (days < 1 || days > 92) throw new ApiError(400, "资源计划窗口必须是 1–92 天");
  const allocations = normalizeAllocations(input.allocations ?? []);

  return prisma.$transaction(async (tx) => {
    await lockPlanOwner(tx, userId);
    const target = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!target || target.status !== "active") throw new ApiError(400, "计划成员不存在或已停用");
    await validateAllocations(tx, userId, from.text, to.text, allocations);
    return tx.resourcePlanWindow.create({
      data: {
        userId,
        dateFrom: from.value,
        dateTo: to.value,
        createdBy: actor.id,
        allocations: {
          create: allocations.map((allocation) => ({
            taskId: allocation.taskId,
            date: dateOnly(allocation.date, "allocation.date").value,
            hours: allocation.hours,
          })),
        },
      },
      include: { allocations: true },
    });
  });
}

export async function updateResourcePlan(actor: SessionUser, input: Record<string, unknown>) {
  const planId = id(input.id, "id");
  const current = await prisma.resourcePlanWindow.findUnique({ where: { id: planId } });
  if (!current) throw new ApiError(404, "资源计划不存在");
  await assertCanManagePlan(actor, current.userId);
  const action = input.action;

  return prisma.$transaction(async (tx) => {
    await lockPlanOwner(tx, current.userId);
    const fresh = await tx.resourcePlanWindow.findUnique({ where: { id: planId } });
    if (!fresh) throw new ApiError(404, "资源计划不存在");
    if (action === "replace_allocations") {
      if (fresh.status !== "draft") throw new ApiError(409, "只有草稿计划可以修改分配");
      const allocations = normalizeAllocations(input.allocations);
      const from = fresh.dateFrom.toISOString().slice(0, 10);
      const to = fresh.dateTo.toISOString().slice(0, 10);
      await validateAllocations(tx, fresh.userId, from, to, allocations);
      await tx.resourcePlanAllocation.deleteMany({ where: { planWindowId: planId } });
      if (allocations.length) {
        await tx.resourcePlanAllocation.createMany({
          data: allocations.map((allocation) => ({
            planWindowId: planId,
            taskId: allocation.taskId,
            date: dateOnly(allocation.date, "allocation.date").value,
            hours: allocation.hours,
          })),
        });
      }
      return tx.resourcePlanWindow.findUniqueOrThrow({ where: { id: planId }, include: { allocations: true } });
    }
    if (action === "publish") {
      if (fresh.status !== "draft") throw new ApiError(409, "只有草稿计划可以发布");
      const overlap = await tx.resourcePlanWindow.findFirst({
        where: {
          userId: fresh.userId,
          status: "published",
          id: { not: fresh.id },
          dateFrom: { lte: fresh.dateTo },
          dateTo: { gte: fresh.dateFrom },
        },
        select: { id: true },
      });
      if (overlap) throw new ApiError(409, "该成员已有重叠的已发布计划窗口");
      return tx.resourcePlanWindow.update({ where: { id: planId }, data: { status: "published" }, include: { allocations: true } });
    }
    if (action === "archive") {
      if (fresh.status === "archived") return fresh;
      return tx.resourcePlanWindow.update({ where: { id: planId }, data: { status: "archived" }, include: { allocations: true } });
    }
    throw new ApiError(400, "action 必须是 replace_allocations、publish 或 archive");
  });
}
