import { requirePerm, apiError } from "@/lib/rbac";
import { listTags } from "@/lib/services/kbService";

export async function GET() {
  try {
    await requirePerm("kb:read");
    return Response.json(await listTags());
  } catch (e) {
    return apiError(e);
  }
}
