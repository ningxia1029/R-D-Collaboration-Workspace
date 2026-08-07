import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    await requirePerm("time:read", task.projectId);
    return Response.json(
      await prisma.timeEntry.findMany({
        where: { taskId: params.id },
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
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    const user = await requirePerm("time:log", task.projectId);
    const data = await req.json();
    const entry = await prisma.timeEntry.create({
      data: {
        taskId: params.id,
        userId: (data.userId as string) ?? user.id,
        date: data.date ? new Date(data.date) : new Date(),
        hours: Number(data.hours),
        note: data.note ?? null,
      },
    });
    await writeAudit({ userId: user.id, action: "TIME_LOG", entityType: "TASK", entityId: params.id, diff: { hours: entry.hours } });
    return Response.json(entry, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
