import { requirePerm, effectiveRole, roleHasPerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    await requirePerm("time:read", task.projectId);
    return Response.json(
      await prisma.timeEntry.findMany({
        where: { taskId: id },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { date: "desc" },
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    const user = await requirePerm("time:log", task.projectId);
    const data = await req.json();
    const role = await effectiveRole(user, task.projectId);
    const requestedUserId = (data.userId as string | undefined) ?? user.id;
    if (requestedUserId !== user.id && !roleHasPerm(role, "time:read_all")) {
      throw new ApiError(403, "只能登记自己的工时");
    }
    const hours = Number(data.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new ApiError(400, "工时必须大于 0 且不超过 24 小时");
    const date = data.date ? new Date(data.date) : new Date();
    if (Number.isNaN(date.getTime())) throw new ApiError(400, "工时日期无效");
    const targetUser = await prisma.user.findUnique({ where: { id: requestedUserId }, select: { id: true, status: true } });
    if (!targetUser || targetUser.status !== "active") throw new ApiError(400, "登记用户不存在或已停用");
    const entry = await prisma.timeEntry.create({
      data: {
        taskId: id,
        userId: requestedUserId,
        date,
        hours,
        note: data.note ?? null,
      },
    });
    await writeAudit({ userId: user.id, action: "TIME_LOG", entityType: "TASK", entityId: id, diff: { hours: entry.hours } });
    return Response.json(entry, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
