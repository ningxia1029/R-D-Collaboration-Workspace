import { apiError, requirePerm } from "@/lib/rbac";
import {
  createOrgUnit,
  createPosition,
  getOrganizationAdminSnapshot,
  updateMemberOrganization,
  updateOrgUnit,
  updatePosition,
} from "@/lib/services/organizationService";

export async function GET() {
  try {
    await requirePerm("org:manage");
    return Response.json(await getOrganizationAdminSnapshot());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePerm("org:manage");
    const body = (await request.json()) as Record<string, unknown>;
    if (body.kind === "org_unit") return Response.json(await createOrgUnit(body), { status: 201 });
    if (body.kind === "position") return Response.json(await createPosition(body), { status: 201 });
    return Response.json({ error: "kind 必须是 org_unit 或 position" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requirePerm("org:manage");
    const body = (await request.json()) as Record<string, unknown>;
    if (body.kind === "org_unit") return Response.json(await updateOrgUnit(body));
    if (body.kind === "position") return Response.json(await updatePosition(body));
    if (body.kind === "member") return Response.json(await updateMemberOrganization(body));
    return Response.json({ error: "kind 必须是 org_unit、position 或 member" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
