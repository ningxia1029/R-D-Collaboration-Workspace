import { requirePerm, apiError } from "@/lib/rbac";
import { listBomItems, createBomItem } from "@/lib/services/bomService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("bom:read", projectId);
    return Response.json(await listBomItems(projectId, url.searchParams.get("phaseId")));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    if (!data.projectId || !data.mpn || !data.name) return Response.json({ error: "projectId/mpn/name 必填" }, { status: 400 });
    const user = await requirePerm("bom:create", data.projectId);
    return Response.json(await createBomItem(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
