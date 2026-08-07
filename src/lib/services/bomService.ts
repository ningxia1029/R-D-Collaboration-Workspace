// BOM 服务：齐套率、Delayed 卡脖子物料联动 Block 任务、导入导出
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";

export const bomInclude = {
  material: { select: { id: true, mpn: true, manufacturer: true, category: true } },
  phase: { select: { id: true, phaseName: true } },
  eco: { select: { id: true, ecoNumber: true } },
} as const;

export interface KitRate {
  total: number;
  arrived: number;
  rate: number; // 0-100
  assemblyReady: boolean;
  byStatus: Record<string, number>;
}

/** 齐套率 = Arrived 数 / 该阶段总数 */
export async function getKitRate(projectId: string, phaseId?: string | null): Promise<KitRate> {
  const rows = await prisma.bomItem.groupBy({
    by: ["status"],
    where: { projectId, ...(phaseId ? { phaseId } : {}) },
    _count: { _all: true },
  });
  const byStatus: Record<string, number> = {};
  let total = 0;
  let arrived = 0;
  for (const r of rows) {
    byStatus[r.status] = r._count._all;
    total += r._count._all;
    if (r.status === "Arrived") arrived = r._count._all;
  }
  const rate = total === 0 ? 0 : Math.round((arrived / total) * 1000) / 10;
  return { total, arrived, rate, assemblyReady: total > 0 && arrived === total, byStatus };
}

export async function listBomItems(projectId: string, phaseId?: string | null) {
  return prisma.bomItem.findMany({
    where: { projectId, ...(phaseId ? { phaseId } : {}) },
    include: bomInclude,
    orderBy: [{ status: "asc" }, { mpn: "asc" }],
  });
}

/** Delayed + isCritical 物料联动：自动 Block / 恢复组装任务 */
export async function syncAssemblyBlock(userId: string | null, projectId: string, phaseId?: string | null) {
  const delayedCritical = await prisma.bomItem.findMany({
    where: { projectId, ...(phaseId ? { phaseId } : {}), status: "Delayed", isCritical: true },
    select: { id: true, mpn: true },
  });

  // 关联了这些物料的任务 + 标题含组装/贴片/装配 的任务
  const linkedTaskIds = delayedCritical.length
    ? (
        await prisma.entityLink.findMany({
          where: {
            entityType: "BOM_ITEM",
            entityId: { in: delayedCritical.map((d) => d.mpn) },
            taskId: { not: null },
          },
          select: { taskId: true },
        })
      ).map((l) => l.taskId!)
    : [];
  const assemblyTasks = await prisma.task.findMany({
    where: {
      projectId,
      OR: [
        { id: { in: linkedTaskIds } },
        { title: { contains: "组装" } },
        { title: { contains: "贴片" } },
        { title: { contains: "装配" } },
      ],
    },
  });

  if (delayedCritical.length > 0) {
    // Block 未完成的任务
    for (const task of assemblyTasks) {
      if (task.status !== "Done" && task.status !== "Blocked") {
        await prisma.task.update({ where: { id: task.id }, data: { status: "Blocked" } });
        await writeAudit({
          userId, action: "AUTO_BLOCK", entityType: "TASK", entityId: task.id,
          diff: { from: task.status, to: "Blocked", reason: `卡脖子物料延迟: ${delayedCritical.map((d) => d.mpn).join(", ")}` },
        });
      }
    }
    return { blocked: assemblyTasks.length, delayed: delayedCritical.map((d) => d.mpn) };
  }

  // 无延迟卡脖子物料 → 恢复被自动 Block 的任务（查审计日志确认是 AUTO_BLOCK 的）
  for (const task of assemblyTasks) {
    if (task.status === "Blocked") {
      const autoBlock = await prisma.auditLog.findFirst({
        where: { entityType: "TASK", entityId: task.id, action: "AUTO_BLOCK" },
        orderBy: { createdAt: "desc" },
      });
      const manualAfter = await prisma.auditLog.findFirst({
        where: { entityType: "TASK", entityId: task.id, action: { not: "AUTO_BLOCK" }, createdAt: { gt: autoBlock?.createdAt ?? new Date(0) } },
      });
      if (autoBlock && !manualAfter) {
        const from = (JSON.parse(autoBlock.diffJson ?? "{}") as { from?: string }).from ?? "To Do";
        await prisma.task.update({ where: { id: task.id }, data: { status: from } });
        await writeAudit({ userId, action: "AUTO_UNBLOCK", entityType: "TASK", entityId: task.id, diff: { from: "Blocked", to: from } });
      }
    }
  }
  return { blocked: 0, delayed: [] };
}

export async function createBomItem(userId: string, data: Record<string, unknown>) {
  const item = await prisma.bomItem.create({
    data: {
      projectId: data.projectId as string,
      phaseId: (data.phaseId as string) ?? null,
      materialId: (data.materialId as string) ?? null,
      mpn: data.mpn as string,
      name: data.name as string,
      spec: (data.spec as string) ?? null,
      refDes: (data.refDes as string) ?? null,
      qty: (data.qty as number) ?? 1,
      status: (data.status as string) ?? "Unordered",
      supplierUrl: (data.supplierUrl as string) ?? null,
      eta: data.eta ? new Date(data.eta as string) : null,
      ecoId: (data.ecoId as string) ?? null,
      isCritical: (data.isCritical as boolean) ?? false,
      productNodeId: (data.productNodeId as string) ?? null,
    },
    include: bomInclude,
  });
  await writeAudit({ userId, action: "CREATE", entityType: "BOM_ITEM", entityId: item.id, diff: { mpn: item.mpn } });
  await indexEntity({ entityType: "BOM_ITEM", entityId: item.id, projectId: item.projectId, title: `${item.mpn} ${item.name}`, body: item.spec });
  const blockResult = await syncAssemblyBlock(userId, item.projectId, item.phaseId);
  const kitRate = await getKitRate(item.projectId, item.phaseId);
  return { item, kitRate, blockResult };
}

export async function updateBomItem(userId: string, id: string, data: Record<string, unknown>) {
  const before = await prisma.bomItem.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "物料不存在");
  const patch: Record<string, unknown> = {};
  const fields = ["mpn", "name", "spec", "refDes", "qty", "status", "supplierUrl", "ecoId", "isCritical", "phaseId", "materialId", "productNodeId"];
  for (const f of fields) if (f in data) patch[f] = data[f];
  if ("eta" in data) patch.eta = data.eta ? new Date(data.eta as string) : null;

  const item = await prisma.bomItem.update({ where: { id }, data: patch, include: bomInclude });
  await writeAudit({ userId, action: "UPDATE", entityType: "BOM_ITEM", entityId: id, diff: { before: { status: before.status }, after: patch } });
  await indexEntity({ entityType: "BOM_ITEM", entityId: item.id, projectId: item.projectId, title: `${item.mpn} ${item.name}`, body: item.spec });

  const blockResult = "status" in patch || before.status !== item.status
    ? await syncAssemblyBlock(userId, item.projectId, item.phaseId)
    : null;
  const kitRate = await getKitRate(item.projectId, item.phaseId);
  return { item, kitRate, blockResult };
}

export async function deleteBomItem(userId: string, id: string) {
  const before = await prisma.bomItem.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "物料不存在");
  await prisma.bomItem.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "BOM_ITEM", entityId: id, diff: { mpn: before.mpn } });
  await removeFromIndex("BOM_ITEM", id);
  return getKitRate(before.projectId, before.phaseId);
}

/** CSV/Excel 导入：前端解析后提交行数据 */
export async function importBomItems(userId: string, projectId: string, phaseId: string | null, rows: Record<string, unknown>[]) {
  if (!rows.length) throw new ApiError(400, "导入数据为空");
  const results = [];
  for (const row of rows) {
    // 物料库自动匹配 / 创建
    let materialId: string | null = null;
    const mpn = String(row.mpn ?? "").trim();
    if (!mpn) continue;
    const material = await prisma.material.upsert({
      where: { mpn },
      create: { mpn, name: String(row.name ?? mpn), spec: (row.spec as string) ?? null },
      update: {},
    });
    materialId = material.id;
    const created = await prisma.bomItem.create({
      data: {
        projectId,
        phaseId,
        materialId,
        mpn,
        name: String(row.name ?? mpn),
        spec: (row.spec as string) ?? null,
        refDes: (row.refDes as string) ?? null,
        qty: Number(row.qty) || 1,
        status: (row.status as string) || "Unordered",
        supplierUrl: (row.supplierUrl as string) ?? null,
        eta: row.eta ? new Date(row.eta as string) : null,
        isCritical: Boolean(row.isCritical),
      },
    });
    results.push(created);
    await indexEntity({ entityType: "BOM_ITEM", entityId: created.id, projectId, title: `${created.mpn} ${created.name}`, body: created.spec });
  }
  await writeAudit({ userId, action: "IMPORT", entityType: "BOM_ITEM", entityId: projectId, diff: { count: results.length } });
  const blockResult = await syncAssemblyBlock(userId, projectId, phaseId);
  const kitRate = await getKitRate(projectId, phaseId);
  return { count: results.length, kitRate, blockResult };
}

/** 导出 CSV */
export async function exportBomCsv(projectId: string, phaseId?: string | null): Promise<string> {
  const items = await listBomItems(projectId, phaseId);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "MPN,Name,Spec,RefDes,Qty,Status,Supplier,ETA,IsCritical,ECO";
  const lines = items.map((i) =>
    [i.mpn, i.name, i.spec, i.refDes, i.qty, i.status, i.supplierUrl, i.eta?.toISOString().slice(0, 10), i.isCritical ? "Y" : "N", i.eco?.ecoNumber].map(esc).join(",")
  );
  return "﻿" + [header, ...lines].join("\n");
}
