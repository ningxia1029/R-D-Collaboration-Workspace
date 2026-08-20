import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateBomItem, deleteBomItem } from "@/lib/services/bomService";

type Ctx = { params: Promise<{ id: string }> };

async function projectOf(id: string) {
  const item = await prisma.bomItem.findUnique({ where: { id }, select: { projectId: true } });
  if (!item) throw new ApiError(404, "物料不存在");
  return item.projectId;
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const projectId = await projectOf(id);
    const user = await requirePerm("bom:update", projectId);
    return Response.json(await updateBomItem(user.id, id, await req.json()));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const projectId = await projectOf(id);
    const user = await requirePerm("bom:delete", projectId);
    return Response.json(await deleteBomItem(user.id, id));
  } catch (e) {
    return apiError(e);
  }
}
