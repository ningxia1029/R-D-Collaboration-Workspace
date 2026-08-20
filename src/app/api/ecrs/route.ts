import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { createEcr } from "@/lib/services/changeService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("ecr:read", projectId);
    const ecrs = await prisma.changeRequest.findMany({
        where: { projectId },
        include: { eco: { select: { id: true, ecoNumber: true } } },
        orderBy: { createdAt: "desc" },
      });
    const approvals = await prisma.approvalRecord.findMany({
      where: { targetType: "ECR", targetId: { in: ecrs.map((ecr) => ecr.id) } },
      orderBy: { createdAt: "asc" },
    });
    return Response.json(ecrs.map((ecr) => ({ ...ecr, approvals: approvals.filter((item) => item.targetId === ecr.id) })));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    if (!data.projectId || !data.title || !data.type) return Response.json({ error: "projectId/title/type 必填" }, { status: 400 });
    const user = await requirePerm("ecr:create", data.projectId);
    return Response.json(await createEcr(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
