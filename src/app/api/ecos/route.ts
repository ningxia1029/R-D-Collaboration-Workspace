import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { createEco } from "@/lib/services/changeService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("eco:read", projectId);
    return Response.json(
      await prisma.changeLog.findMany({
        where: { projectId },
        include: {
          ecr: { select: { id: true, ecrNumber: true, title: true } },
          impacts: true,
          _count: { select: { tasks: true, bomItems: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    if (!data.projectId || !data.type) return Response.json({ error: "projectId 与 type 必填" }, { status: 400 });
    const user = await requirePerm("eco:create", data.projectId);
    return Response.json(await createEco(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
