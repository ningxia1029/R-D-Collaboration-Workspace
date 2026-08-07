import { requirePerm, apiError } from "@/lib/rbac";
import { updateBomItem } from "@/lib/services/bomService";

export async function PATCH(req: Request) {
  try {
    const { ids, patch, projectId } = await req.json();
    if (!Array.isArray(ids) || !projectId) return Response.json({ error: "ids 与 projectId 必填" }, { status: 400 });
    const user = await requirePerm("bom:update", projectId);
    const results = [];
    for (const id of ids) results.push(await updateBomItem(user.id, id, patch ?? {}));
    return Response.json(results);
  } catch (e) {
    return apiError(e);
  }
}
