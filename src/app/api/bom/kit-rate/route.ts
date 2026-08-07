import { requirePerm, apiError } from "@/lib/rbac";
import { getKitRate } from "@/lib/services/bomService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("bom:read", projectId);
    return Response.json(await getKitRate(projectId, url.searchParams.get("phaseId")));
  } catch (e) {
    return apiError(e);
  }
}
