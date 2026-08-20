import { requireAuth, requirePerm, requireProjectAccess, effectiveRole, roleHasPerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateTask, deleteTask } from "@/lib/services/taskService";

type Ctx = { params: Promise<{ id: string }> };

async function loadProjectId(id: string) {
  const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true, assigneeId: true, createdBy: true } });
  if (!task) throw new ApiError(404, "任务不存在");
  return task;
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    const task = await loadProjectId(id);
    await requireProjectAccess(user, task.projectId);
    // task:update 可改任意任务；task:update_own 只能改自己负责的
    const projectRole = await effectiveRole(user, task.projectId);
    const canAny = roleHasPerm(projectRole, "task:update");
    const data = await req.json();
    if (canAny) {
      return Response.json(await updateTask(user.id, id, data));
    }
    if (!roleHasPerm(projectRole, "task:update_own")) {
      return Response.json({ error: "缺少权限：task:update" }, { status: 403 });
    }
    // 仅本人任务，且不允许改指派
    if ("assigneeId" in data && data.assigneeId !== user.id) {
      return Response.json({ error: "无权重新指派任务" }, { status: 403 });
    }
    return Response.json(await updateTask(user.id, id, data, { onlyOwn: true }));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const task = await loadProjectId(id);
    const user = await requirePerm("task:delete", task.projectId);
    return Response.json(await deleteTask(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
