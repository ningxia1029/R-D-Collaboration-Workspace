import { requirePerm, apiError } from "@/lib/rbac";
import { exportBomCsv } from "@/lib/services/bomService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("bom:export", projectId);
    const csv = await exportBomCsv(projectId, url.searchParams.get("phaseId"));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bom-${projectId}.csv"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
