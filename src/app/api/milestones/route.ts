import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const data = await req.json();
    if (!data.projectId || !data.name || !data.date) return Response.json({ error: "projectId/name/date 必填" }, { status: 400 });
    const user = await requirePerm("project:update", data.projectId);
    const ms = await prisma.milestone.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        date: new Date(data.date),
        phaseId: data.phaseId ?? null,
      },
    });
    await writeAudit({ userId: user.id, action: "CREATE", entityType: "MILESTONE", entityId: ms.id, diff: { name: ms.name } });
    return Response.json(ms, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const data = await req.json();
    const ms = await prisma.milestone.findUnique({ where: { id: data.id } });
    if (!ms) return Response.json({ error: "里程碑不存在" }, { status: 404 });
    const user = await requirePerm("project:update", ms.projectId);
    const updated = await prisma.milestone.update({
      where: { id: data.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
      },
    });
    await writeAudit({ userId: user.id, action: "UPDATE", entityType: "MILESTONE", entityId: data.id });
    return Response.json(updated);
  } catch (e) {
    return apiError(e);
  }
}
