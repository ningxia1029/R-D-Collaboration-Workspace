import { requireEntityPerm, effectiveRole, roleHasPerm, apiError } from "@/lib/rbac";
import { getDocument, updateDocument, deleteDocument } from "@/lib/services/kbService";
import { PERMISSIONS } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requireEntityPerm("kb:read", "DOCUMENT", id);
    const document = await getDocument(id);
    const role = await effectiveRole(user, document.projectId ?? undefined);
    return Response.json({
      ...document,
      currentUserAccess: {
        role,
        permissions: PERMISSIONS.filter((permission) => roleHasPerm(role, permission)),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requireEntityPerm("kb:update", "DOCUMENT", id);
    return Response.json(await updateDocument(user.id, id, await req.json()));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requireEntityPerm("kb:delete", "DOCUMENT", id);
    return Response.json(await deleteDocument(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
