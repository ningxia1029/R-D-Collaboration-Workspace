export const dynamic = "force-dynamic";

/** 进程存活探针：不依赖数据库或运行配置。 */
export async function GET() {
  return Response.json({ status: "live" });
}
