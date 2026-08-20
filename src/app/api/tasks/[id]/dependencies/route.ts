import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { addDependency, removeDependency } from "@/lib/services/taskService";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    await requirePerm("task:read", task.projectId);
    return Response.json(await prisma.taskDependency.findMany({
      where: { OR: [{ predecessorId: id }, { successorId: id }] },
      include: {
        predecessor: { select: { id: true, title: true } },
        successor: { select: { id: true, title: true } },
      },
    }));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    const user = await requirePerm("task:update", task.projectId);
    const data = await req.json();
    return Response.json(
      await addDependency(user.id, { predecessorId: id, successorId: data.successorId, type: data.type, lagDays: data.lagDays }),
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    const user = await requirePerm("task:update", task.projectId);
    const { dependencyId } = await req.json();
    const dependency = await prisma.taskDependency.findUnique({ where: { id: dependencyId } });
    if (!dependency || (dependency.predecessorId !== id && dependency.successorId !== id)) {
      throw new ApiError(404, "依赖不存在或不属于当前任务");
    }
    return Response.json(await removeDependency(user.id, dependencyId));
  } catch (e) {
    return apiError(e);
  }
}
