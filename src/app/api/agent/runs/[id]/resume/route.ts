import { resumeOwnedAgentRun, resumeRunInputSchema } from "@/lib/agent/runs";
import { apiError, requireAuth } from "@/lib/rbac";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    const input = resumeRunInputSchema.parse(await request.json());
    return Response.json(await resumeOwnedAgentRun(user.id, id, input.message));
  } catch (error: unknown) {
    return apiError(error);
  }
}
