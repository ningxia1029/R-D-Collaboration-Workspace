import { retryOwnedAgentRun } from "@/lib/agent/runs";
import { apiError, requireAuth } from "@/lib/rbac";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    return Response.json(await retryOwnedAgentRun(user, id), { status: 201 });
  } catch (error: unknown) {
    return apiError(error);
  }
}
