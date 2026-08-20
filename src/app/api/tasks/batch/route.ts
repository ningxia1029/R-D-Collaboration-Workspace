import { requirePerm, apiError } from "@/lib/rbac";
import { batchUpdateTasks } from "@/lib/services/taskService";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  try {
    const { ids, patch, projectId } = await req.json();
    if (!Array.isArray(ids) || !projectId) return Response.json({ error: "ids 与 projectId 必填" }, { status: 400 });
    const user = await requirePerm("task:update", projectId);
    const matched = await prisma.task.count({ where: { id: { in: ids }, projectId } });
    if (matched !== new Set(ids).size) return Response.json({ error: "任务列表包含不存在或跨项目的任务" }, { status: 400 });
    return Response.json(await batchUpdateTasks(user.id, ids, patch ?? {}));
  } catch (e) {
    return apiError(e);
  }
}
