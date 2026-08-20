import { requirePerm, apiError } from "@/lib/rbac";
import { upsertMaterial, deleteMaterial } from "@/lib/services/plmService";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requirePerm("plm:manage");
    return Response.json(await upsertMaterial(user.id, await req.json(), id));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requirePerm("plm:manage");
    return Response.json(await deleteMaterial(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
