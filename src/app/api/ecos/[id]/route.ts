import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateEco, deleteEco, transitionEco } from "@/lib/services/changeService";

type Ctx = { params: { id: string } };

async function projectOf(id: string) {
  const eco = await prisma.changeLog.findUnique({ where: { id }, select: { projectId: true } });
  if (!eco) throw new ApiError(404, "ECO 不存在");
  return eco.projectId;
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const projectId = await projectOf(params.id);
    const body = await req.json();
    // 状态流转：{ transition: "PENDING" | "APPROVED" | "IMPLEMENTED" | "CLOSED" | "DRAFT" }
    if (body.transition) {
      const permMap: Record<string, "eco:update" | "eco:approve" | "eco:implement"> = {
        PENDING: "eco:update",
        APPROVED: "eco:approve",
        DRAFT: "eco:approve",
        IMPLEMENTED: "eco:implement",
        CLOSED: "eco:implement",
      };
      const user = await requirePerm(permMap[body.transition] ?? "eco:update", projectId);
      return Response.json(await transitionEco(user.id, params.id, body.transition, body.comment));
    }
    const user = await requirePerm("eco:update", projectId);
    return Response.json(await updateEco(user.id, params.id, body));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const projectId = await projectOf(params.id);
    const user = await requirePerm("eco:update", projectId);
    return Response.json(await deleteEco(user.id, params.id));
  } catch (e) {
    return apiError(e);
  }
}
