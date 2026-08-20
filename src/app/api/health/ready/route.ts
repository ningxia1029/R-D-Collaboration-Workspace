import { prisma } from "@/lib/prisma";
import { inspectRuntimeReadiness } from "@/lib/runtimeReadiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 配置和 PostgreSQL 可用性探针；响应始终只返回固定状态和值码。 */
export async function GET() {
  const readiness = inspectRuntimeReadiness(process.env);
  if (!readiness.ready) {
    return Response.json({ status: "not_ready", issues: readiness.issues }, { status: 503 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      await tx.$queryRaw`SELECT 1`;
    }, { maxWait: 2_000, timeout: 3_000 });
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "not_ready", issues: ["DATABASE_UNAVAILABLE"] }, { status: 503 });
  }
}
