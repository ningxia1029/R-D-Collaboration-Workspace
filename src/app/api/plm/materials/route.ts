import { requirePerm, apiError } from "@/lib/rbac";
import { listMaterials, upsertMaterial } from "@/lib/services/plmService";

export async function GET(req: Request) {
  try {
    await requirePerm("plm:read");
    const q = new URL(req.url).searchParams.get("q") ?? undefined;
    return Response.json(await listMaterials(q));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePerm("plm:manage");
    const data = await req.json();
    if (!data.mpn || !data.name) return Response.json({ error: "mpn 与 name 必填" }, { status: 400 });
    return Response.json(await upsertMaterial(user.id, data), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
