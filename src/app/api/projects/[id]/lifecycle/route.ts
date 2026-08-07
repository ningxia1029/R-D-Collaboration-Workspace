import { requirePerm, apiError } from "@/lib/rbac";
import { transitionLifecycle } from "@/lib/services/projectService";
import { lifecycleStageSchema } from "@/lib/constants";

type Ctx = { params: { id: string } };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requirePerm("project:update", params.id);
    const body = await req.json();
    const toStage = lifecycleStageSchema.parse(body.toStage);
    const result = await transitionLifecycle(user.id, params.id, toStage, body.comment, body.force === true);
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}
