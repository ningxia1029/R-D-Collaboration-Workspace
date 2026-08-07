import { requirePerm, apiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    await requirePerm("admin:audit_read");
    const url = new URL(req.url);
    const take = Math.min(Number(url.searchParams.get("take")) || 100, 500);
    return Response.json(
      await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take })
    );
  } catch (e) {
    return apiError(e);
  }
}
