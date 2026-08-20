import { apiError, requireAuth, requirePerm } from "@/lib/rbac";
import { createResourcePlan, listResourcePlans, updateResourcePlan } from "@/lib/services/resourcePlanService";

export async function GET(request: Request) {
  try {
    const user = await requirePerm("time:read");
    const userId = new URL(request.url).searchParams.get("userId") ?? undefined;
    return Response.json(await listResourcePlans(user, userId));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    return Response.json(await createResourcePlan(user, await request.json()), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    return Response.json(await updateResourcePlan(user, await request.json()));
  } catch (error) {
    return apiError(error);
  }
}
