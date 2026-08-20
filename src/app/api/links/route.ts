import { requireAuth, requirePerm, requireProjectAccess, entityProjectId, apiError, ApiError, type ProjectEntityType } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/** 任务追溯关联：GET ?taskId= / POST { taskId, entityType, entityId } / DELETE { id } */
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const taskId = new URL(req.url).searchParams.get("taskId");
    if (!taskId) return Response.json({ error: "taskId 必填" }, { status: 400 });
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    await requireProjectAccess(user, task.projectId);
    return Response.json(await prisma.entityLink.findMany({ where: { taskId } }));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    const task = await prisma.task.findUnique({ where: { id: data.taskId }, select: { projectId: true } });
    if (!task) throw new ApiError(404, "任务不存在");
    await requirePerm("task:update", task.projectId);
    const entityType = String(data.entityType ?? "") as ProjectEntityType | "PRODUCT";
    if (!["PRODUCT", "BOM_ITEM", "DOCUMENT", "TECH_SPEC", "ECO"].includes(entityType)) {
      throw new ApiError(400, "不支持的关联实体类型");
    }
    const entityId = String(data.entityId ?? "");
    if (!entityId) throw new ApiError(400, "entityId 必填");
    if (entityType === "PRODUCT") {
      const product = await prisma.product.findUnique({ where: { id: entityId }, select: { id: true } });
      if (!product) throw new ApiError(404, "产品不存在");
    } else {
      const linkedProjectId = await entityProjectId(entityType, entityId);
      if (linkedProjectId && linkedProjectId !== task.projectId) throw new ApiError(400, "禁止跨项目建立追溯关联");
    }
    const link = await prisma.entityLink.create({
      data: { taskId: data.taskId, entityType, entityId },
    });
    return Response.json(link, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    const link = await prisma.entityLink.findUnique({ where: { id }, include: { task: { select: { projectId: true } } } });
    if (!link) throw new ApiError(404, "关联不存在");
    await requirePerm("task:update", link.task!.projectId);
    await prisma.entityLink.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
