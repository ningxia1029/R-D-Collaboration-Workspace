import { requirePerm, apiError } from "@/lib/rbac";
import { batchUpdateTasks } from "@/lib/services/taskService";

export async function PATCH(req: Request) {
  try {
    const { ids, patch, projectId } = await req.json();
    if (!Array.isArray(ids) || !projectId) return Response.json({ error: "ids 与 projectId 必填" }, { status: 400 });
    const user = await requirePerm("task:update", projectId);
    return Response.json(await batchUpdateTasks(user.id, ids, patch ?? {}));
  } catch (e) {
    return apiError(e);
  }
}
