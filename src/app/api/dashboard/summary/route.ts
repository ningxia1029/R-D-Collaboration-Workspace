import { requirePerm, apiError } from "@/lib/rbac";
import { getDashboardSummary } from "@/lib/services/dashboardService";

export async function GET() {
  try {
    const user = await requirePerm("dashboard:read");
    return Response.json(await getDashboardSummary(user));
  } catch (e) {
    return apiError(e);
  }
}
