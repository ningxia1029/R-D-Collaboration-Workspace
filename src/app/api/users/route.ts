import { requireAuth, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/** 用户简表（登录即可读，用于负责人/成员选择器） */
export async function GET() {
  try {
    await requireAuth();
    return Response.json(
      await prisma.user.findMany({
        where: { status: "active" },
        select: { id: true, name: true, email: true, role: { select: { name: true } } },
        orderBy: { name: "asc" },
      })
    );
  } catch (e) {
    return apiError(e);
  }
}
