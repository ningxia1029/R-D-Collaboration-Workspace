// Tech Specs 服务：达标判定
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";

/** 达标判定：按 compareRule 数值化比较，非数值按 eq */
export function judgeSpec(spec: { targetValue: string | null; actualValue: string | null; compareRule: string }): "pass" | "fail" | "unknown" {
  if (spec.targetValue == null || spec.actualValue == null || spec.targetValue === "" || spec.actualValue === "") return "unknown";
  const t = Number(spec.targetValue);
  const a = Number(spec.actualValue);
  if (Number.isNaN(t) || Number.isNaN(a)) {
    return spec.targetValue.trim() === spec.actualValue.trim() ? "pass" : "fail";
  }
  switch (spec.compareRule) {
    case "lte": return a <= t ? "pass" : "fail";
    case "eq": return a === t ? "pass" : "fail";
    case "gte":
    default: return a >= t ? "pass" : "fail";
  }
}

export async function listSpecs(projectId: string, phaseId?: string | null) {
  const specs = await prisma.techSpec.findMany({
    where: { projectId, ...(phaseId ? { phaseId } : {}) },
    include: { phase: { select: { id: true, phaseName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return specs.map((s) => ({ ...s, verdict: judgeSpec(s) }));
}

export async function createSpec(userId: string, data: Record<string, unknown>) {
  const spec = await prisma.techSpec.create({
    data: {
      projectId: data.projectId as string,
      phaseId: (data.phaseId as string) ?? null,
      metricName: data.metricName as string,
      targetValue: (data.targetValue as string) ?? null,
      actualValue: (data.actualValue as string) ?? null,
      unit: (data.unit as string) ?? null,
      compareRule: (data.compareRule as string) ?? "gte",
      contentMd: (data.contentMd as string) ?? null,
      firmwareVersion: (data.firmwareVersion as string) ?? null,
    },
  });
  await writeAudit({ userId, action: "CREATE", entityType: "TECH_SPEC", entityId: spec.id, diff: { metric: spec.metricName } });
  await indexEntity({ entityType: "TECH_SPEC", entityId: spec.id, projectId: spec.projectId, title: spec.metricName, body: `${spec.contentMd ?? ""} ${spec.firmwareVersion ?? ""}` });
  return { ...spec, verdict: judgeSpec(spec) };
}

export async function updateSpec(userId: string, id: string, data: Record<string, unknown>) {
  const before = await prisma.techSpec.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "参数不存在");
  const patch: Record<string, unknown> = {};
  for (const f of ["metricName", "targetValue", "actualValue", "unit", "compareRule", "contentMd", "firmwareVersion", "phaseId"]) {
    if (f in data) patch[f] = data[f];
  }
  const spec = await prisma.techSpec.update({ where: { id }, data: patch });
  await writeAudit({ userId, action: "UPDATE", entityType: "TECH_SPEC", entityId: id, diff: { before: { actual: before.actualValue }, after: patch } });
  await indexEntity({ entityType: "TECH_SPEC", entityId: spec.id, projectId: spec.projectId, title: spec.metricName, body: `${spec.contentMd ?? ""} ${spec.firmwareVersion ?? ""}` });
  return { ...spec, verdict: judgeSpec(spec) };
}

export async function deleteSpec(userId: string, id: string) {
  const before = await prisma.techSpec.findUnique({ where: { id } });
  if (!before) throw new ApiError(404, "参数不存在");
  await prisma.techSpec.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "TECH_SPEC", entityId: id, diff: { metric: before.metricName } });
  await removeFromIndex("TECH_SPEC", id);
}
