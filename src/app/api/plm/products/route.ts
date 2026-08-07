import { requirePerm, apiError } from "@/lib/rbac";
import { getProductTree, createProductNode } from "@/lib/services/plmService";

export async function GET() {
  try {
    await requirePerm("plm:read");
    return Response.json(await getProductTree());
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePerm("plm:manage");
    const data = await req.json();
    if (!data.name || !data.code) return Response.json({ error: "name 与 code 必填" }, { status: 400 });
    return Response.json(await createProductNode(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
