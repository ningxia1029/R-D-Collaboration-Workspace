import { requirePerm, apiError } from "@/lib/rbac";
import { listTasks, createTask, getGanttData } from "@/lib/services/taskService";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
    await requirePerm("task:read", projectId);
    if (url.searchParams.get("view") === "gantt") {
      return Response.json(await getGanttData(projectId));
    }
    return Response.json(
      await listTasks(projectId, {
        status: url.searchParams.get("status") ?? undefined,
        priority: url.searchParams.get("priority") ?? undefined,
        phaseId: url.searchParams.get("phaseId") ?? undefined,
        assigneeId: url.searchParams.get("assigneeId") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json();
    if (!data.projectId || !data.title) return Response.json({ error: "projectId 与 title 必填" }, { status: 400 });
    const user = await requirePerm("task:create", data.projectId);
    return Response.json(await createTask(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
