import { requirePerm, apiError } from "@/lib/rbac";
import { importBomItems } from "@/lib/services/bomService";

export async function POST(req: Request) {
  try {
    const { projectId, phaseId, rows } = await req.json();
    if (!projectId || !Array.isArray(rows)) return Response.json({ error: "projectId 与 rows 必填" }, { status: 400 });
    const user = await requirePerm("bom:import", projectId);
    return Response.json(await importBomItems(user.id, projectId, phaseId ?? null, rows), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
