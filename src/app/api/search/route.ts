import { requireAuth, apiError, visibleProjectIds } from "@/lib/rbac";
import { globalSearch } from "@/lib/services/searchService";

export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const ids = await visibleProjectIds(user);
    return Response.json(await globalSearch(q, ids));
  } catch (e) {
    return apiError(e);
  }
}
