import { requireAuth, requirePerm, apiError } from "@/lib/rbac";
import { listProjects, createProject } from "@/lib/services/projectService";

export async function GET() {
  try {
    const user = await requirePerm("project:read");
    return Response.json(await listProjects(user));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePerm("project:create");
    const data = await req.json();
    if (!data.name || !data.code) return Response.json({ error: "名称与编号必填" }, { status: 400 });
    return Response.json(await createProject(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
