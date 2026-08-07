// 知识库服务：文档 + 版本历史 + 标签 + FTS 同步
import { prisma } from "@/lib/prisma";
import { ApiError, visibleProjectIds, type SessionUser } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { indexEntity, removeFromIndex } from "@/lib/services/searchService";

export async function listDocuments(user: SessionUser, filters?: { category?: string; tag?: string; q?: string; projectId?: string }) {
  const ids = await visibleProjectIds(user);
  return prisma.document.findMany({
    where: {
      ...(ids === null ? {} : { OR: [{ projectId: null }, { projectId: { in: ids } }] }),
      ...(filters?.projectId ? { projectId: filters.projectId } : {}),
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.q ? { OR: [{ title: { contains: filters.q } }, { summary: { contains: filters.q } }] } : {}),
      ...(filters?.tag ? { tags: { some: { tag: { name: filters.tag } } } } : {}),
    },
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

async function syncTags(documentId: string, tagNames: string[]) {
  await prisma.documentTag.deleteMany({ where: { documentId } });
  for (const name of tagNames.map((x) => x.trim()).filter(Boolean)) {
    const tag = await prisma.tag.upsert({ where: { name }, create: { name }, update: {} });
    await prisma.documentTag.create({ data: { documentId, tagId: tag.id } });
  }
}

export async function createDocument(userId: string, data: {
  title: string; category?: string; summary?: string; projectId?: string | null;
  contentMd: string; tags?: string[];
}) {
  const doc = await prisma.document.create({
    data: {
      title: data.title,
      category: data.category ?? null,
      summary: data.summary ?? null,
      projectId: data.projectId ?? null,
      createdBy: userId,
      versions: { create: { version: 1, contentMd: data.contentMd, changeNote: "初始版本", createdBy: userId } },
    },
  });
  await syncTags(doc.id, data.tags ?? []);
  await writeAudit({ userId, action: "CREATE", entityType: "DOCUMENT", entityId: doc.id, diff: { title: doc.title } });
  await indexEntity({ entityType: "DOCUMENT", entityId: doc.id, projectId: doc.projectId, title: doc.title, body: data.contentMd });
  return getDocument(doc.id);
}

/** 更新文档：内容变化时生成新版本 */
export async function updateDocument(userId: string, id: string, data: {
  title?: string; category?: string; summary?: string; contentMd?: string; changeNote?: string; tags?: string[];
}) {
  const doc = await prisma.document.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!doc) throw new ApiError(404, "文档不存在");

  const patch: Record<string, unknown> = {};
  const dataAny = data as Record<string, unknown>;
  for (const f of ["title", "category", "summary"]) if (f in dataAny) patch[f] = dataAny[f];
  await prisma.document.update({ where: { id }, data: patch });

  let newVersion = doc.versions[0]?.version ?? 0;
  if (typeof data.contentMd === "string" && data.contentMd !== doc.versions[0]?.contentMd) {
    newVersion = (doc.versions[0]?.version ?? 0) + 1;
    await prisma.docVersion.create({
      data: { documentId: id, version: newVersion, contentMd: data.contentMd, changeNote: data.changeNote ?? null, createdBy: userId },
    });
  }
  if (data.tags) await syncTags(id, data.tags);

  await writeAudit({ userId, action: "UPDATE", entityType: "DOCUMENT", entityId: id, diff: { version: newVersion } });
  const latest = await prisma.docVersion.findFirst({ where: { documentId: id }, orderBy: { version: "desc" } });
  await indexEntity({ entityType: "DOCUMENT", entityId: id, projectId: doc.projectId, title: (patch.title as string) ?? doc.title, body: latest?.contentMd });
  return getDocument(id);
}

export async function deleteDocument(userId: string, id: string) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new ApiError(404, "文档不存在");
  await prisma.document.delete({ where: { id } });
  await writeAudit({ userId, action: "DELETE", entityType: "DOCUMENT", entityId: id, diff: { title: doc.title } });
  await removeFromIndex("DOCUMENT", id);
}

export async function listTags() {
  return prisma.tag.findMany({ include: { _count: { select: { docs: true } } }, orderBy: { name: "asc" } });
}
