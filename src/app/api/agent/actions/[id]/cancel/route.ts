import { prismaActionService } from "@/lib/agent/actions/service";
import { apiError, requireAuth } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    return Response.json(await prismaActionService.cancelOwnedProposal(user, id));
  } catch (error: unknown) {
    return apiError(error);
  }
}
