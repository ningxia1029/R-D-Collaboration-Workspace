import { requirePerm, requireProjectAccess, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateProject } from "@/lib/services/projectService";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("project:read");
    await requireProjectAccess(user, params.id);
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        owner: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, code: true } },
        phases: { orderBy: { sortOrder: "asc" } },
        milestones: { orderBy: { date: "asc" } },
        members: { include: { user: { select: { id: true, name: true, email: true } }, role: true } },
      },
    });
    if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
    return Response.json(project);
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("project:update", params.id);
    return Response.json(await updateProject(user.id, params.id, await req.json()));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("project:archive", params.id);
    await prisma.project.update({ where: { id: params.id }, data: { status: "archived" } });
    await writeAudit({ userId: user.id, action: "ARCHIVE", entityType: "PROJECT", entityId: params.id });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
