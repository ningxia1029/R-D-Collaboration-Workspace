import { requireAuth, requirePerm, apiError } from "@/lib/rbac";
import { listDocuments, createDocument } from "@/lib/services/kbService";

export async function GET(req: Request) {
  try {
    const user = await requirePerm("kb:read");
    const url = new URL(req.url);
    return Response.json(
      await listDocuments(user, {
        category: url.searchParams.get("category") ?? undefined,
        tag: url.searchParams.get("tag") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        projectId: url.searchParams.get("projectId") ?? undefined,
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const user = await requirePerm("kb:create", data.projectId ?? undefined);
    if (!data.title || typeof data.contentMd !== "string") {
      return Response.json({ error: "title 与 contentMd 必填" }, { status: 400 });
    }
    return Response.json(await createDocument(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
