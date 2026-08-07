import { requirePerm, apiError } from "@/lib/rbac";
import { exportEcoReport } from "@/lib/services/changeService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("eco:read", projectId);
    const md = await exportEcoReport(projectId);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="eco-report-${projectId}.md"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
