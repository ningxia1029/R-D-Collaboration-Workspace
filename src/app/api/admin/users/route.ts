import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    await requirePerm("admin:user_manage");
    return Response.json(
      await prisma.user.findMany({
        include: { role: true, _count: { select: { memberships: true, assignedTasks: true } } },
        orderBy: { createdAt: "asc" },
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requirePerm("admin:user_manage");
    const data = await req.json();
    if (!data.email || !data.name || !data.password || !data.roleId) {
      return Response.json({ error: "email/name/password/roleId 必填" }, { status: 400 });
    }
    const user = await prisma.user.create({
      data: {
        email: String(data.email).trim().toLowerCase(),
        name: data.name,
        passwordHash: await bcrypt.hash(data.password, 10),
        roleId: data.roleId,
      },
      include: { role: true },
    });
    return Response.json({ ...user, passwordHash: undefined }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requirePerm("admin:user_manage");
    const data = await req.json();
    const patch: Record<string, unknown> = {};
    for (const f of ["name", "roleId", "status"]) if (f in data) patch[f] = data[f];
    if (data.password) patch.passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.update({ where: { id: data.id }, data: patch, include: { role: true } });
    return Response.json({ ...user, passwordHash: undefined });
  } catch (e) {
    return apiError(e);
  }
}
