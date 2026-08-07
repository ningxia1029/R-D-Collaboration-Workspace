import { requirePerm, apiError } from "@/lib/rbac";
import { getDocument, updateDocument, deleteDocument } from "@/lib/services/kbService";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requirePerm("kb:read");
    return Response.json(await getDocument(params.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("kb:update");
    return Response.json(await updateDocument(user.id, params.id, await req.json()));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("kb:delete");
    return Response.json(await deleteDocument(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
