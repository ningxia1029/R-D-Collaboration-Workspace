import { cancelOwnedAgentRun } from "@/lib/agent/runs";
import { apiError, requireAuth } from "@/lib/rbac";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    return Response.json(await cancelOwnedAgentRun(user.id, id));
  } catch (error: unknown) {
    return apiError(error);
  }
}
