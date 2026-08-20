// 知识库服务：文档 + 版本历史 + 标签 + FTS 同步
import { prisma } from "@/lib/prisma";
import { ApiError, visibleProjectIds, type SessionUser } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";
import { documentVisibilityScope, withDocumentScope } from "@/lib/services/documentScope";
import type { Prisma } from "@prisma/client";
import {
  documentIndexDedupKey,
  enqueueOutboxEvent,
  writeActivityEvent,
} from "@/lib/agent/activity";

export async function listDocuments(user: SessionUser, filters?: { category?: string; tag?: string; q?: string; projectId?: string }) {
  const ids = await visibleProjectIds(user);
  const scope = documentVisibilityScope(ids);
  return prisma.document.findMany({
    where: withDocumentScope(
      scope,
      filters?.projectId ? { projectId: filters.projectId } : {},
      filters?.category ? { category: filters.category } : {},
      filters?.q ? { OR: [{ title: { contains: filters.q } }, { summary: { contains: filters.q } }] } : {},
      filters?.tag ? { tags: { some: { tag: { name: filters.tag } } } } : {},
    ),
    include: {
      creator: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
      _count: { select: { versions: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getDocument(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
      versions: { orderBy: { version: "desc" } },
    },
  });
  if (!doc) throw new ApiError(404, "文档不存在");
  return doc;
}

async function syncTags(tx: Prisma.TransactionClient, documentId: string, tagNames: string[]) {
  await tx.documentTag.deleteMany({ where: { documentId } });
  for (const name of tagNames.map((x) => x.trim()).filter(Boolean)) {
    const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
    await tx.documentTag.create({ data: { documentId, tagId: tag.id } });
  }
}

export async function createDocument(userId: string, data: {
  title: string; category?: string; summary?: string; projectId?: string | null;
  contentMd: string; tags?: string[];
}) {
  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        title: data.title,
        category: data.category ?? null,
        summary: data.summary ?? null,
        projectId: data.projectId ?? null,
        createdBy: userId,
        versions: { create: { version: 1, contentMd: data.contentMd, changeNote: "初始版本", createdBy: userId } },
      },
    });
    await syncTags(tx, created.id, data.tags ?? []);
    await writeAudit({
      userId,
      projectId: created.projectId,
      eventType: "document.created",
      action: "CREATE",
      entityType: "DOCUMENT",
      entityId: created.id,
      diff: { title: created.title, version: 1 },
    }, tx);
    await writeActivityEvent(tx, {
      projectId: created.projectId,
      actorUserId: userId,
      eventType: "document.created",
      entityType: "DOCUMENT",
      entityId: created.id,
      payload: { title: created.title, version: 1 },
    });
    await enqueueOutboxEvent(tx, {
      aggregateType: "DOCUMENT",
      aggregateId: created.id,
      eventType: "DOCUMENT_INDEX_UPSERT",
      dedupKey: documentIndexDedupKey(created.id, `v1:${created.updatedAt.toISOString()}`),
      payload: { documentId: created.id, documentVersion: 1, projectId: created.projectId },
    });
    return created;
  });
  await indexEntity({ entityType: "DOCUMENT", entityId: doc.id, projectId: doc.projectId, title: doc.title, body: data.contentMd });
  return getDocument(doc.id);
}

/** 更新文档：内容变化时生成新版本 */
export async function updateDocument(userId: string, id: string, data: {
  title?: string; category?: string; summary?: string; contentMd?: string; changeNote?: string; tags?: string[];
}) {
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.document.findUnique({
      where: { id },
      include: { versions: { orderBy: [{ version: "desc" }, { createdAt: "desc" }], take: 1 } },
    });
    if (!before) throw new ApiError(404, "文档不存在");

    const patch: Record<string, unknown> = {};
    const dataAny = data as Record<string, unknown>;
    for (const field of ["title", "category", "summary"]) if (field in dataAny) patch[field] = dataAny[field];
    let newVersion = before.versions[0]?.version ?? 0;
    let latestContent = before.versions[0]?.contentMd ?? "";
    if (typeof data.contentMd === "string" && data.contentMd !== before.versions[0]?.contentMd) {
      newVersion += 1;
      latestContent = data.contentMd;
      await tx.docVersion.create({
        data: {
          documentId: id,
          version: newVersion,
          contentMd: data.contentMd,
          changeNote: data.changeNote ?? null,
          createdBy: userId,
        },
      });
    }
    if (data.tags) await syncTags(tx, id, data.tags);
    const updated = await tx.document.update({ where: { id }, data: { ...patch, updatedAt: new Date() } });
    await writeAudit({
      userId,
      projectId: updated.projectId,
      eventType: "document.updated",
      action: "UPDATE",
      entityType: "DOCUMENT",
      entityId: id,
      diff: { version: newVersion, changedFields: Object.keys(dataAny) },
    }, tx);
    await writeActivityEvent(tx, {
      projectId: updated.projectId,
      actorUserId: userId,
      eventType: "document.updated",
      entityType: "DOCUMENT",
      entityId: id,
      payload: { title: updated.title, version: newVersion, changedFields: Object.keys(dataAny) },
    });
    await enqueueOutboxEvent(tx, {
      aggregateType: "DOCUMENT",
      aggregateId: id,
      eventType: "DOCUMENT_INDEX_UPSERT",
      dedupKey: documentIndexDedupKey(id, `v${newVersion}:${updated.updatedAt.toISOString()}`),
      payload: { documentId: id, documentVersion: newVersion, projectId: updated.projectId },
    });
    return { updated, latestContent };
  });
  await indexEntity({
    entityType: "DOCUMENT",
    entityId: id,
    projectId: result.updated.projectId,
    title: result.updated.title,
    body: result.latestContent,
  });
  return getDocument(id);
}

export async function deleteDocument(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) throw new ApiError(404, "文档不存在");
    await tx.document.delete({ where: { id } });
    await writeAudit({
      userId,
      projectId: doc.projectId,
      eventType: "document.deleted",
      action: "DELETE",
      entityType: "DOCUMENT",
      entityId: id,
      diff: { title: doc.title },
    }, tx);
    await writeActivityEvent(tx, {
      projectId: doc.projectId,
      actorUserId: userId,
      eventType: "document.deleted",
      entityType: "DOCUMENT",
      entityId: id,
      payload: { title: doc.title },
    });
    await enqueueOutboxEvent(tx, {
      aggregateType: "DOCUMENT",
      aggregateId: id,
      eventType: "DOCUMENT_INDEX_DELETE",
      dedupKey: documentIndexDedupKey(id, "deleted"),
      payload: { documentId: id, projectId: doc.projectId },
    });
  });
  await removeFromIndex("DOCUMENT", id);
}

export async function listTags() {
  return prisma.tag.findMany({ include: { _count: { select: { docs: true } } }, orderBy: { name: "asc" } });
}
