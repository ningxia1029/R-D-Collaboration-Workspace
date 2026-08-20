import { getAgentControlSnapshot } from "@/lib/agent/control";
import { apiError, requireAuth } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const control = await getAgentControlSnapshot();
    return Response.json({
      enabled: control.enabled,
      operational: control.operational,
      maintenanceMessage: control.maintenanceMessage,
      disabledToolCount: control.disabledTools.length,
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
