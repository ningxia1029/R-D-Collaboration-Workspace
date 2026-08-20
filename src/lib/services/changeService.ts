// 工程变更服务：ECR→ECO 两级流转、单号生成、影响面、审批记录
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";
import type { Prisma } from "@prisma/client";
import { compareAndSetStatus } from "@/lib/services/transitionGuard";
import { writeActivityEvent } from "@/lib/agent/activity";

/** 事务内自增发号：ECO-2026-001（跨年自动重置） */
export async function nextNumber(prefix: "ECO" | "ECR", tx?: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const row = await (tx ?? prisma).sequenceCounter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${key}-${String(row.value).padStart(3, "0")}`;
}

// ==================== ECR ====================

const ECR_FLOW: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["CONVERTED"],
  REJECTED: [],
  CONVERTED: [],
};

const IMPACT_TYPES = ["BOM_ITEM", "TASK", "TECH_SPEC", "PRODUCT"] as const;
type ImpactInput = { entityType: string; entityId: string; note?: string };

async function validateImpacts(tx: Prisma.TransactionClient, projectId: string, impacts: ImpactInput[]) {
  for (const impact of impacts) {
    if (!IMPACT_TYPES.includes(impact.entityType as (typeof IMPACT_TYPES)[number]) || !impact.entityId) {
      throw new ApiError(400, "ECO 影响项类型或实体 ID 无效");
    }
    if (impact.entityType === "PRODUCT") {
      const product = await tx.product.findUnique({ where: { id: impact.entityId }, select: { id: true } });
      if (!product) throw new ApiError(404, "影响产品不存在");
      continue;
    }
    const scoped = impact.entityType === "BOM_ITEM"
      ? await tx.bomItem.findUnique({ where: { id: impact.entityId }, select: { projectId: true } })
      : impact.entityType === "TASK"
        ? await tx.task.findUnique({ where: { id: impact.entityId }, select: { projectId: true } })
        : await tx.techSpec.findUnique({ where: { id: impact.entityId }, select: { projectId: true } });
    if (!scoped) throw new ApiError(404, "影响实体不存在");
    if (scoped.projectId !== projectId) throw new ApiError(400, "禁止关联其他项目的影响实体");
  }
}

async function transitionEcr(userId: string, id: string, to: string, comment?: string) {
  return prisma.$transaction(async (tx) => {
    const ecr = await tx.changeRequest.findUnique({ where: { id } });
    if (!ecr) throw new ApiError(404, "ECR 不存在");
    if (!ECR_FLOW[ecr.status]?.includes(to)) {
      throw new ApiError(400, `ECR 状态不允许从 ${ecr.status} 流转到 ${to}`);
    }
    if (!(await compareAndSetStatus(tx.changeRequest, id, ecr.status, to))) {
      throw new ApiError(409, "ECR 状态已被其他操作更新，请刷新后重试");
    }
    const action = to === "SUBMITTED" ? "SUBMIT" : to === "APPROVED" ? "APPROVE" : to === "REJECTED" ? "REJECT" : "CONVERT";
    await tx.approvalRecord.create({ data: { targetType: "ECR", targetId: id, approverId: userId, action, comment: comment ?? null } });
    await writeAudit({ userId, action: "STATUS_CHANGE", entityType: "ECR", entityId: id, diff: { from: ecr.status, to } }, tx);
    await writeActivityEvent(tx, {
      projectId: ecr.projectId,
      actorUserId: userId,
      eventType: `ecr.${to.toLocaleLowerCase()}`,
      entityType: "ECR",
      entityId: id,
      payload: { number: ecr.ecrNumber, title: ecr.title, action, statusFrom: ecr.status, statusTo: to },
    });
    return tx.changeRequest.findUniqueOrThrow({ where: { id } });
  });
}

export async function createEcr(userId: string, data: Record<string, unknown>) {
  return prisma.$transaction(async (tx) => {
    const ecrNumber = await nextNumber("ECR", tx);
    const ecr = await tx.changeRequest.create({
      data: {
        ecrNumber,
        projectId: data.projectId as string,
        title: data.title as string,
        type: data.type as string,
        reason: (data.reason as string) ?? null,
        description: (data.description as string) ?? null,
        requestedBy: userId,
      },
    });
    await writeAudit({ userId, action: "CREATE", entityType: "ECR", entityId: ecr.id, diff: { ecrNumber } }, tx);
    await writeActivityEvent(tx, {
      projectId: ecr.projectId,
      actorUserId: userId,
      eventType: "ecr.created",
      entityType: "ECR",
      entityId: ecr.id,
      payload: { number: ecr.ecrNumber, title: ecr.title, action: "CREATE" },
    });
    return ecr;
  });
}

export async function submitEcr(userId: string, id: string) {
  return transitionEcr(userId, id, "SUBMITTED");
}

export async function approveEcr(userId: string, id: string, comment?: string) {
  return transitionEcr(userId, id, "APPROVED", comment);
}

export async function rejectEcr(userId: string, id: string, comment?: string) {
  return transitionEcr(userId, id, "REJECTED", comment);
}

/** ECR(APPROVED) 转 ECO：事务内建 ECO + 回填关联 */
export async function convertEcrToEco(userId: string, id: string) {
  const eco = await prisma.$transaction(async (tx) => {
    const ecr = await tx.changeRequest.findUnique({ where: { id }, include: { eco: true } });
    if (!ecr) throw new ApiError(404, "ECR 不存在");
    if (ecr.status !== "APPROVED") throw new ApiError(400, "仅已批准的 ECR 可转 ECO");
    if (ecr.eco) throw new ApiError(400, "该 ECR 已转换过 ECO");

    if (!(await compareAndSetStatus(tx.changeRequest, id, "APPROVED", "CONVERTED"))) {
      throw new ApiError(409, "ECR 状态已变化或已被转换，请刷新后重试");
    }
    const ecoNumber = await nextNumber("ECO", tx);
    const created = await tx.changeLog.create({
      data: {
        projectId: ecr.projectId,
        ecoNumber,
        type: ecr.type,
        reason: ecr.reason,
        description: `[${ecr.ecrNumber}] ${ecr.title}\n${ecr.description ?? ""}`,
        status: "DRAFT",
        ecrId: ecr.id,
        createdBy: userId,
      },
    });
    await tx.approvalRecord.create({ data: { targetType: "ECR", targetId: id, approverId: userId, action: "CONVERT", comment: `转为 ${ecoNumber}` } });
    await writeAudit({ userId, action: "CONVERT", entityType: "ECO", entityId: created.id, diff: { from: ecr.ecrNumber, ecoNumber } }, tx);
    await writeActivityEvent(tx, {
      projectId: ecr.projectId,
      actorUserId: userId,
      eventType: "ecr.converted",
      entityType: "ECR",
      entityId: ecr.id,
      payload: { number: ecr.ecrNumber, title: ecr.title, action: "CONVERT", convertedEcoNumber: ecoNumber },
    });
    await writeActivityEvent(tx, {
      projectId: created.projectId,
      actorUserId: userId,
      eventType: "eco.created",
      entityType: "ECO",
      entityId: created.id,
      payload: { number: created.ecoNumber, action: "CREATE", sourceEcrNumber: ecr.ecrNumber },
    });
    return created;
  });
  await indexEntity({ entityType: "ECO", entityId: eco.id, projectId: eco.projectId, title: eco.ecoNumber, body: eco.description });
  return eco;
}

// ==================== ECO ====================

const ECO_FLOW: Record<string, string[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["APPROVED", "DRAFT"],
  APPROVED: ["IMPLEMENTED"],
  IMPLEMENTED: ["CLOSED"],
  CLOSED: [],
};

export async function createEco(userId: string, data: Record<string, unknown>) {
  const impacts = (data.impacts as ImpactInput[]) ?? [];
  const projectId = data.projectId as string;
  const eco = await prisma.$transaction(async (tx) => {
    await validateImpacts(tx, projectId, impacts);
    const ecoNumber = await nextNumber("ECO", tx);
    const created = await tx.changeLog.create({
      data: {
        projectId,
        ecoNumber,
        type: data.type as string,
        reason: (data.reason as string) ?? null,
        description: (data.description as string) ?? null,
        versionFrom: (data.versionFrom as string) ?? null,
        versionTo: (data.versionTo as string) ?? null,
        createdBy: userId,
      },
    });
    if (impacts.length) {
      await tx.changeImpact.createMany({
        data: impacts.map((item) => ({ ecoId: created.id, entityType: item.entityType, entityId: item.entityId, note: item.note ?? null })),
      });
    }
    await writeAudit({ userId, action: "CREATE", entityType: "ECO", entityId: created.id, diff: { ecoNumber } }, tx);
    await writeActivityEvent(tx, {
      projectId: created.projectId,
      actorUserId: userId,
      eventType: "eco.created",
      entityType: "ECO",
      entityId: created.id,
      payload: { number: created.ecoNumber, action: "CREATE" },
    });
    return created;
  });
  await indexEntity({ entityType: "ECO", entityId: eco.id, projectId: eco.projectId, title: eco.ecoNumber, body: `${eco.reason ?? ""} ${eco.description ?? ""}` });
  return eco;
}

export async function transitionEco(userId: string, id: string, to: string, comment?: string) {
  return prisma.$transaction(async (tx) => {
    const eco = await tx.changeLog.findUnique({ where: { id } });
    if (!eco) throw new ApiError(404, "ECO 不存在");
    if (!ECO_FLOW[eco.status]?.includes(to)) {
      throw new ApiError(400, `ECO 状态不允许从 ${eco.status} 流转到 ${to}`);
    }
    if (!(await compareAndSetStatus(tx.changeLog, id, eco.status, to))) {
      throw new ApiError(409, "ECO 状态已被其他操作更新，请刷新后重试");
    }
    const action = to === "PENDING" ? "SUBMIT" : to === "APPROVED" ? "APPROVE" : to === "IMPLEMENTED" ? "IMPLEMENT" : to === "CLOSED" ? "APPROVE" : "REJECT";
    await tx.approvalRecord.create({ data: { targetType: "ECO", targetId: id, approverId: userId, action, comment: comment ?? null } });
    await writeAudit({ userId, action: "STATUS_CHANGE", entityType: "ECO", entityId: id, diff: { from: eco.status, to } }, tx);
    await writeActivityEvent(tx, {
      projectId: eco.projectId,
      actorUserId: userId,
      eventType: `eco.${to.toLocaleLowerCase()}`,
      entityType: "ECO",
      entityId: id,
      payload: { number: eco.ecoNumber, action, statusFrom: eco.status, statusTo: to },
    });
    return tx.changeLog.findUniqueOrThrow({ where: { id } });
  });
}

export async function updateEco(userId: string, id: string, data: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const f of ["type", "reason", "description", "versionFrom", "versionTo"]) {
    if (f in data) patch[f] = data[f];
  }
  const updated = await prisma.$transaction(async (tx) => {
    const eco = await tx.changeLog.findUnique({ where: { id } });
    if (!eco) throw new ApiError(404, "ECO 不存在");
    if (eco.status !== "DRAFT") throw new ApiError(400, "仅草稿状态的 ECO 可编辑");
    const changed = await tx.changeLog.updateMany({ where: { id, status: "DRAFT" }, data: patch });
    if (changed.count !== 1) throw new ApiError(409, "ECO 已提交或被其他操作更新，请刷新后重试");
    await writeAudit({ userId, action: "UPDATE", entityType: "ECO", entityId: id, diff: patch }, tx);
    return tx.changeLog.findUniqueOrThrow({ where: { id } });
  });
  const eco = updated;
  await indexEntity({ entityType: "ECO", entityId: id, projectId: eco.projectId, title: eco.ecoNumber, body: `${updated.reason ?? ""} ${updated.description ?? ""}` });
  return updated;
}

export async function deleteEco(userId: string, id: string) {
  const eco = await prisma.changeLog.findUnique({ where: { id } });
  if (!eco) throw new ApiError(404, "ECO 不存在");
  if (eco.status !== "DRAFT") throw new ApiError(400, "仅草稿状态的 ECO 可删除");
  await prisma.changeLog.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "ECO", entityId: id, diff: { ecoNumber: eco.ecoNumber } });
  await removeFromIndex("ECO", id);
}

/** ECO 变更报告（Markdown） */
export async function exportEcoReport(projectId: string): Promise<string> {
  const [project, ecos] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.changeLog.findMany({
      where: { projectId },
      include: { impacts: true, ecr: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!project) throw new ApiError(404, "项目不存在");
  const lines: string[] = [
    `# ${project.name} 工程变更报告`,
    "",
    `> 导出时间：${new Date().toLocaleString("zh-CN")}　变更单总数：${ecos.length}`,
    "",
  ];
  for (const eco of ecos) {
    lines.push(`## ${eco.ecoNumber}（${eco.type} / ${eco.status}）`);
    lines.push("");
    if (eco.ecr) lines.push(`- 来源 ECR：${eco.ecr.ecrNumber} ${eco.ecr.title}`);
    if (eco.versionFrom || eco.versionTo) lines.push(`- 版本演进：${eco.versionFrom ?? "-"} → ${eco.versionTo ?? "-"}`);
    if (eco.reason) lines.push(`- 变更起因：${eco.reason}`);
    if (eco.description) lines.push(`- 变更说明：${eco.description}`);
    lines.push(`- 创建时间：${eco.createdAt.toLocaleString("zh-CN")}`);
    if (eco.impacts.length) {
      lines.push("- 影响范围：");
      for (const imp of eco.impacts) lines.push(`  - [${imp.entityType}] ${imp.entityId}${imp.note ? `：${imp.note}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
