import { requireAuth, requirePerm, requireProjectAccess, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateTask, deleteTask } from "@/lib/services/taskService";
import { ROLE_PERMISSION_MAP } from "@/lib/constants";

type Ctx = { params: { id: string } };

async function loadProjectId(id: string) {
  const task = await prisma.task.findUnique({ where: { id }, select: { projectId: true, assigneeId: true, createdBy: true } });
  if (!task) throw new ApiError(404, "任务不存在");
  return task;
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireAuth();
    const task = await loadProjectId(params.id);
    await requireProjectAccess(user, task.projectId);
    // task:update 可改任意任务；task:update_own 只能改自己负责的
    const canAny =
      user.roleName === "admin" ||
      (ROLE_PERMISSION_MAP[user.roleName as keyof typeof ROLE_PERMISSION_MAP] as readonly string[] | undefined)?.includes("task:update");
    const data = await req.json();
    if (canAny) {
      return Response.json(await updateTask(user.id, params.id, data));
    }
    // engineer：仅本人任务，且不允许改指派
    if ("assigneeId" in data && data.assigneeId !== user.id) {
      return Response.json({ error: "无权重新指派任务" }, { status: 403 });
    }
    return Response.json(await updateTask(user.id, params.id, data, { onlyOwn: true }));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const task = await loadProjectId(params.id);
    const user = await requirePerm("task:delete", task.projectId);
    return Response.json(await deleteTask(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
