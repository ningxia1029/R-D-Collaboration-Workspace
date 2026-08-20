import { requireAuth, requireEntityAccess, effectiveRole, roleCanComment, apiError, ApiError, type ProjectEntityType } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    if (!entityType || !entityId) return Response.json({ error: "entityType 与 entityId 必填" }, { status: 400 });
    if (!["TASK", "ECO", "ECR", "DOCUMENT"].includes(entityType)) throw new ApiError(400, "不支持的评论实体类型");
    await requireEntityAccess(user, entityType as ProjectEntityType, entityId);
    const comments = await prisma.comment.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "asc" },
    });
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(comments.map((c) => c.userId))] } },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return Response.json(comments.map((c) => ({ ...c, user: userMap.get(c.userId) ?? null })));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const data = await req.json();
    if (!data.entityType || !data.entityId || !data.content) {
      return Response.json({ error: "entityType/entityId/content 必填" }, { status: 400 });
    }
    if (!["TASK", "ECO", "ECR", "DOCUMENT"].includes(data.entityType)) throw new ApiError(400, "不支持的评论实体类型");
    const projectId = await requireEntityAccess(user, data.entityType as ProjectEntityType, data.entityId);
    const role = await effectiveRole(user, projectId ?? undefined);
    if (!roleCanComment(role)) throw new ApiError(403, "访客仅可查看评论");
    const comment = await prisma.comment.create({
      data: { entityType: data.entityType, entityId: data.entityId, userId: user.id, content: data.content },
    });
    return Response.json({ ...comment, user: { id: user.id, name: user.name } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
