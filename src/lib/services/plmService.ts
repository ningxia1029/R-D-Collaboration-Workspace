// PLM 服务：产品树、物料库、产品版本
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";

/** 产品树（含嵌套子节点与物料） */
export async function getProductTree() {
  const nodes = await prisma.product.findMany({
    include: { material: true, versions: { orderBy: { releasedAt: "desc" } } },
    orderBy: { code: "asc" },
  });
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] as unknown[] }]));
  const roots: unknown[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      (byId.get(node.parentId)!.children as unknown[]).push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function createProductNode(userId: string, data: Record<string, unknown>) {
  if (data.parentId) {
    const parent = await prisma.product.findUnique({ where: { id: data.parentId as string } });
    if (!parent) throw new ApiError(400, "父节点不存在");
  }
  const node = await prisma.product.create({
    data: {
      name: data.name as string,
      code: data.code as string,
      parentId: (data.parentId as string) ?? null,
      nodeType: (data.nodeType as string) ?? "ASSEMBLY",
      materialId: (data.materialId as string) ?? null,
      qty: (data.qty as number) ?? 1,
      currentVersion: (data.currentVersion as string) ?? null,
    },
  });
  await writeAudit({ userId, action: "CREATE", entityType: "PRODUCT", entityId: node.id, diff: { name: node.name } });
  return node;
}

export async function updateProductNode(userId: string, id: string, data: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const f of ["name", "nodeType", "materialId", "qty", "currentVersion", "status"]) if (f in data) patch[f] = data[f];
  const node = await prisma.product.update({ where: { id }, data: patch });
  await writeAudit({ userId, action: "UPDATE", entityType: "PRODUCT", entityId: id, diff: patch });
  return node;
}

export async function deleteProductNode(userId: string, id: string) {
  const children = await prisma.product.count({ where: { parentId: id } });
  if (children > 0) throw new ApiError(400, "请先删除子节点");
  await prisma.product.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "PRODUCT", entityId: id });
}

/** 发布新版本（通常由 ECO 落地触发） */
export async function releaseProductVersion(userId: string, data: { productId: string; version: string; note?: string; ecoId?: string }) {
  const pv = await prisma.productVersion.create({ data });
  await prisma.product.update({ where: { id: data.productId }, data: { currentVersion: data.version } });
  await writeAudit({ userId, action: "RELEASE", entityType: "PRODUCT", entityId: data.productId, diff: { version: data.version } });
  return pv;
}

// ---- 物料库 ----
export async function listMaterials(q?: string) {
  return prisma.material.findMany({
    where: q ? { OR: [{ mpn: { contains: q } }, { name: { contains: q } }, { manufacturer: { contains: q } }] } : {},
    include: { _count: { select: { bomItems: true } } },
    orderBy: { mpn: "asc" },
  });
}

export async function upsertMaterial(userId: string, data: Record<string, unknown>, id?: string) {
  const payload = {
    mpn: data.mpn as string,
    name: data.name as string,
    spec: (data.spec as string) ?? null,
    manufacturer: (data.manufacturer as string) ?? null,
    category: (data.category as string) ?? null,
    unit: (data.unit as string) ?? null,
    defaultSupplierUrl: (data.defaultSupplierUrl as string) ?? null,
  };
  const material = id
    ? await prisma.material.update({ where: { id }, data: payload })
    : await prisma.material.create({ data: payload });
  await writeAudit({ userId, action: id ? "UPDATE" : "CREATE", entityType: "MATERIAL", entityId: material.id, diff: { mpn: material.mpn } });
  return material;
}

export async function deleteMaterial(userId: string, id: string) {
  const used = await prisma.bomItem.count({ where: { materialId: id } });
  if (used > 0) throw new ApiError(400, `该物料已被 ${used} 个 BOM 条目引用，无法删除`);
  await prisma.material.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "MATERIAL", entityId: id });
}
