import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requirePerm("project:read", id);
    return Response.json(
      await prisma.projectMember.findMany({
        where: { projectId: id },
        include: { user: { select: { id: true, name: true, email: true, status: true } }, role: true },
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requirePerm("project:update", id);
    const data = await req.json();
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: data.userId } },
      create: { projectId: id, userId: data.userId, roleId: data.roleId ?? null },
      update: { roleId: data.roleId ?? null },
    });
    return Response.json(member, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requirePerm("project:update", id);
    const { userId } = await req.json();
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: id, userId } } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
