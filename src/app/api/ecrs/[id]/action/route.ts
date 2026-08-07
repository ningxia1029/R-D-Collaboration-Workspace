import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { submitEcr, approveEcr, rejectEcr, convertEcrToEco } from "@/lib/services/changeService";

type Ctx = { params: { id: string } };

/** POST { action: "submit" | "approve" | "reject" | "convert", comment? } */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const ecr = await prisma.changeRequest.findUnique({ where: { id: params.id }, select: { projectId: true } });
    if (!ecr) throw new ApiError(404, "ECR 不存在");
    const { action, comment } = await req.json();
    const permMap: Record<string, "ecr:submit" | "ecr:approve" | "eco:create"> = {
      submit: "ecr:submit",
      approve: "ecr:approve",
      reject: "ecr:approve",
      convert: "eco:create",
    };
    const perm = permMap[action];
    if (!perm) return Response.json({ error: "未知操作" }, { status: 400 });
    const user = await requirePerm(perm, ecr.projectId);

    switch (action) {
      case "submit": return Response.json(await submitEcr(user.id, params.id));
      case "approve": return Response.json(await approveEcr(user.id, params.id, comment));
      case "reject": return Response.json(await rejectEcr(user.id, params.id, comment));
      case "convert": return Response.json(await convertEcrToEco(user.id, params.id), { status: 201 });
    }
  } catch (e) {
    return apiError(e);
  }
}
