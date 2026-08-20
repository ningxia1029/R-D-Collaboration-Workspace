import { prismaActionService } from "@/lib/agent/actions/service";
import { apiError, requireAuth } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 16 * 1024) return Response.json({ error: "确认请求正文过大" }, { status: 413 });
    return Response.json(await prismaActionService.executeOwnedProposal(user, id, await request.json()));
  } catch (error: unknown) {
    return apiError(error);
  }
}
