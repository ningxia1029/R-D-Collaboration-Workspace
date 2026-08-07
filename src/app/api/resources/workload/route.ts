import { requirePerm, apiError } from "@/lib/rbac";
import { getWorkload } from "@/lib/services/dashboardService";

export async function GET(req: Request) {
  try {
    const user = await requirePerm("time:read");
    const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
    return Response.json(await getWorkload(user, projectId));
  } catch (e) {
    return apiError(e);
  }
}
