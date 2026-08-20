import { getOwnedAgentRun } from "@/lib/agent/runs";
import { apiError, requireAuth } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    return Response.json(await getOwnedAgentRun(user, id));
  } catch (error: unknown) {
    return apiError(error);
  }
}
