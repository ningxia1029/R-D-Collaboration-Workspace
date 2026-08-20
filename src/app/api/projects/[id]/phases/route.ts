import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requirePerm("project:read", id);
    return Response.json(
      await prisma.phase.findMany({ where: { projectId: id }, orderBy: { sortOrder: "asc" } })
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
    const phase = await prisma.phase.create({
      data: {
        projectId: id,
        phaseName: data.phaseName,
        targetDate: data.targetDate ? new Date(data.targetDate) : null,
        sortOrder: data.sortOrder ?? 0,
        status: data.status ?? "pending",
      },
    });
    return Response.json(phase, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requirePerm("project:update", id);
    const data = await req.json();
    const phase = await prisma.phase.update({
      where: { id: data.id },
      data: {
        ...(data.phaseName !== undefined ? { phaseName: data.phaseName } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.targetDate !== undefined ? { targetDate: data.targetDate ? new Date(data.targetDate) : null } : {}),
      },
    });
    return Response.json(phase);
  } catch (e) {
    return apiError(e);
  }
}
