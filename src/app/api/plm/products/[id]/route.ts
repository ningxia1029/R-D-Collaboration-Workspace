import { requirePerm, apiError } from "@/lib/rbac";
import { updateProductNode, deleteProductNode, releaseProductVersion } from "@/lib/services/plmService";

type Ctx = { params: { id: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("plm:manage");
    const body = await req.json();
    if (body.releaseVersion) {
      return Response.json(
        await releaseProductVersion(user.id, { productId: params.id, version: body.releaseVersion, note: body.note, ecoId: body.ecoId }),
        { status: 201 }
      );
    }
    return Response.json(await updateProductNode(user.id, params.id, body));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("plm:manage");
    return Response.json(await deleteProductNode(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
