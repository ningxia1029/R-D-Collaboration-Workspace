import { requireAuth, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/** 角色列表（登录即可读，用于成员管理下拉） */
export async function GET() {
  try {
    await requireAuth();
    return Response.json(
      await prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } })
    );
  } catch (e) {
    return apiError(e);
  }
}
