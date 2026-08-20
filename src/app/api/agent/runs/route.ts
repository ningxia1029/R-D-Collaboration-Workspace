import { createAgentRun, createRunInputSchema, listAgentRuns } from "@/lib/agent/runs";
import { apiError, requireAuth } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const take = Math.min(Number(new URL(request.url).searchParams.get("take")) || 30, 100);
    return Response.json(await listAgentRuns(user.id, take));
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const parsed = createRunInputSchema.parse(await request.json());
    const run = await createAgentRun(user, parsed);
    return Response.json(run, { status: 201 });
  } catch (error: unknown) {
    return apiError(error);
  }
}
