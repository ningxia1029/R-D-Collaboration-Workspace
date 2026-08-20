// PostgreSQL 搜索：直接查询业务表，避免与业务数据不同步的 SQLite FTS 影子索引。
import { prisma } from "@/lib/prisma";
import { documentVisibilityScope, withDocumentScope } from "@/lib/services/documentScope";

export type SearchEntityType = "TASK" | "BOM_ITEM" | "TECH_SPEC" | "ECO" | "DOCUMENT";

export interface SearchHit {
  entityType: SearchEntityType;
  entityId: string;
  projectId: string;
  title: string;
  snippet: string;
}

// 保留原服务调用契约；PostgreSQL 模式下无需显式维护影子索引。
export async function ensureSearchIndex() { return true; }
export async function indexEntity(_params: { entityType: SearchEntityType; entityId: string; projectId?: string | null; title: string; body?: string | null }) {}
export async function removeFromIndex(_entityType: SearchEntityType, _entityId: string) {}
export async function reindexAll() { console.log("[search] PostgreSQL 业务表搜索无需重建索引"); }

function clip(value: string | null | undefined, limit = 120) {
  const text = value ?? "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 全局搜索：所有实体统一注入项目可见范围；公共文档对登录用户可见。 */
export async function globalSearch(q: string, visibleIds: string[] | null): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 100);
  if (!query) return [];
  const projectFilter = visibleIds === null ? {} : { projectId: { in: visibleIds } };
  const documentScope = documentVisibilityScope(visibleIds);

  const [tasks, boms, specs, ecos, docs] = await Promise.all([
    prisma.task.findMany({
      where: { ...projectFilter, OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] },
      take: 10,
    }),
    prisma.bomItem.findMany({
      where: { ...projectFilter, OR: [{ mpn: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }, { spec: { contains: query, mode: "insensitive" } }] },
      take: 10,
    }),
    prisma.techSpec.findMany({
      where: { ...projectFilter, OR: [{ metricName: { contains: query, mode: "insensitive" } }, { contentMd: { contains: query, mode: "insensitive" } }] },
      take: 10,
    }),
    prisma.changeLog.findMany({
      where: { ...projectFilter, OR: [{ ecoNumber: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }, { reason: { contains: query, mode: "insensitive" } }] },
      take: 10,
    }),
    prisma.document.findMany({
      where: withDocumentScope(documentScope, { OR: [{ title: { contains: query, mode: "insensitive" } }, { summary: { contains: query, mode: "insensitive" } }, { versions: { some: { contentMd: { contains: query, mode: "insensitive" } } } }] }),
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { contentMd: true } } },
      take: 10,
    }),
  ]);

  return [
    ...tasks.map((r): SearchHit => ({ entityType: "TASK", entityId: r.id, projectId: r.projectId, title: r.title, snippet: clip(r.description) })),
    ...boms.map((r): SearchHit => ({ entityType: "BOM_ITEM", entityId: r.id, projectId: r.projectId, title: `${r.mpn} ${r.name}`, snippet: clip(r.spec) })),
    ...specs.map((r): SearchHit => ({ entityType: "TECH_SPEC", entityId: r.id, projectId: r.projectId, title: r.metricName, snippet: clip(r.contentMd ?? `目标 ${r.targetValue ?? "-"} / 实测 ${r.actualValue ?? "-"}`) })),
    ...ecos.map((r): SearchHit => ({ entityType: "ECO", entityId: r.id, projectId: r.projectId, title: r.ecoNumber, snippet: clip(r.description ?? r.reason) })),
    ...docs.map((r): SearchHit => ({ entityType: "DOCUMENT", entityId: r.id, projectId: r.projectId ?? "", title: r.title, snippet: clip(r.summary ?? r.versions[0]?.contentMd) })),
  ];
}
