import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateSpec, deleteSpec } from "@/lib/services/specService";

type Ctx = { params: { id: string } };

async function projectOf(id: string) {
  const spec = await prisma.techSpec.findUnique({ where: { id }, select: { projectId: true } });
  if (!spec) throw new ApiError(404, "参数不存在");
  return spec.projectId;
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const projectId = await projectOf(params.id);
    const user = await requirePerm("spec:update", projectId);
    return Response.json(await updateSpec(user.id, params.id, await req.json()));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const projectId = await projectOf(params.id);
    const user = await requirePerm("spec:delete", projectId);
    return Response.json(await deleteSpec(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
