import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { addDependency, removeDependency } from "@/lib/services/taskService";

type Ctx = { params: { id: string } };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    const user = await requirePerm("task:update", task.projectId);
    const data = await req.json();
    return Response.json(
      await addDependency(user.id, { predecessorId: params.id, successorId: data.successorId, type: data.type, lagDays: data.lagDays }),
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    const user = await requirePerm("task:update", task.projectId);
    const { dependencyId } = await req.json();
    return Response.json(await removeDependency(user.id, dependencyId));
  } catch (e) {
    return apiError(e);
  }
}
