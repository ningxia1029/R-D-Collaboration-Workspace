import { requirePerm, apiError } from "@/lib/rbac";
import { upsertMaterial, deleteMaterial } from "@/lib/services/plmService";

type Ctx = { params: { id: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("plm:manage");
    return Response.json(await upsertMaterial(user.id, await req.json(), params.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("plm:manage");
    return Response.json(await deleteMaterial(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
