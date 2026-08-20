import { requirePerm, requireProjectAccess, effectiveRole, roleHasPerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { updateProject } from "@/lib/services/projectService";
import { writeAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requirePerm("project:read");
    await requireProjectAccess(user, id);
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, code: true } },
        phases: { orderBy: { sortOrder: "asc" } },
        milestones: { orderBy: { date: "asc" } },
        members: { include: { user: { select: { id: true, name: true, email: true } }, role: true } },
      },
    });
    if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
    const role = await effectiveRole(user, id);
    return Response.json({
      ...project,
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
    const user = await requirePerm("project:update", id);
    return Response.json(await updateProject(user.id, id, await req.json()));
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await requirePerm("project:archive", id);
    await prisma.project.update({ where: { id }, data: { status: "archived" } });
    await writeAudit({ userId: user.id, action: "ARCHIVE", entityType: "PROJECT", entityId: id });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
