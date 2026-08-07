import { requirePerm, apiError } from "@/lib/rbac";
import { listSpecs, createSpec } from "@/lib/services/specService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("spec:read", projectId);
    return Response.json(await listSpecs(projectId, url.searchParams.get("phaseId")));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    if (!data.projectId || !data.metricName) return Response.json({ error: "projectId 与 metricName 必填" }, { status: 400 });
    const user = await requirePerm("spec:create", data.projectId);
    return Response.json(await createSpec(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
