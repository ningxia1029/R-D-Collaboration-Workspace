// 全文搜索：SQLite FTS5（trigram 分词，支持中文子串），失败自动降级 LIKE
import { prisma } from "@/lib/prisma";

let ftsReady: boolean | null = null;

export async function ensureSearchIndex(): Promise<boolean> {
  if (ftsReady !== null) return ftsReady;
  try {
    await prisma.$executeRawUnsafe(
      `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entityType, entityId, projectId, title, body, tokenize='trigram')`
    );
    ftsReady = true;
  } catch {
    try {
      await prisma.$executeRawUnsafe(
        `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entityType, entityId, projectId, title, body)`
      );
      ftsReady = true;
    } catch (e) {
      console.warn("[search] FTS5 不可用，降级 LIKE", e);
      ftsReady = false;
    }
  }
  return ftsReady;
}

export type SearchEntityType = "TASK" | "BOM_ITEM" | "TECH_SPEC" | "ECO" | "DOCUMENT";

export async function indexEntity(params: {
  entityType: SearchEntityType;
  entityId: string;
  projectId?: string | null;
  title: string;
  body?: string | null;
}) {
  if (!(await ensureSearchIndex())) return;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM search_index WHERE entityType = ? AND entityId = ?`,
      params.entityType,
      params.entityId
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO search_index(entityType, entityId, projectId, title, body) VALUES (?,?,?,?,?)`,
      params.entityType,
      params.entityId,
      params.projectId ?? "",
      params.title,
      params.body ?? ""
    );
  } catch (e) {
    console.warn("[search] 索引写入失败", e);
  }
}

export async function removeFromIndex(entityType: SearchEntityType, entityId: string) {
  if (!(await ensureSearchIndex())) return;
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM search_index WHERE entityType = ? AND entityId = ?`,
      entityType,
      entityId
    );
  } catch {
    /* ignore */
  }
}

/** 全量重建索引（seed 直写库后调用） */
export async function reindexAll() {
  if (!(await ensureSearchIndex())) return;
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM search_index`);
    const [tasks, boms, specs, ecos, docs, versions] = await Promise.all([
      prisma.task.findMany({ select: { id: true, projectId: true, title: true, description: true } }),
      prisma.bomItem.findMany({ select: { id: true, projectId: true, mpn: true, name: true, spec: true } }),
      prisma.techSpec.findMany({ select: { id: true, projectId: true, metricName: true, contentMd: true, firmwareVersion: true } }),
      prisma.changeLog.findMany({ select: { id: true, projectId: true, ecoNumber: true, description: true, reason: true } }),
      prisma.document.findMany({ select: { id: true, projectId: true, title: true, summary: true } }),
      prisma.docVersion.findMany({ select: { documentId: true, contentMd: true } }),
    ]);
    for (const t of tasks) {
      await indexEntity({ entityType: "TASK", entityId: t.id, projectId: t.projectId, title: t.title, body: t.description });
    }
    for (const b of boms) {
      await indexEntity({ entityType: "BOM_ITEM", entityId: b.id, projectId: b.projectId, title: `${b.mpn} ${b.name}`, body: b.spec });
    }
    for (const s of specs) {
      await indexEntity({ entityType: "TECH_SPEC", entityId: s.id, projectId: s.projectId, title: s.metricName, body: `${s.contentMd ?? ""} ${s.firmwareVersion ?? ""}` });
    }
    for (const e of ecos) {
      await indexEntity({ entityType: "ECO", entityId: e.id, projectId: e.projectId, title: e.ecoNumber, body: `${e.reason ?? ""} ${e.description ?? ""}` });
    }
    // 文档：每篇取最新版正文进索引
    const latestByDoc = new Map<string, string>();
    for (const v of versions) {
      latestByDoc.set(v.documentId, v.contentMd);
    }
    for (const d of docs) {
      await indexEntity({ entityType: "DOCUMENT", entityId: d.id, projectId: d.projectId, title: d.title, body: `${d.summary ?? ""} ${latestByDoc.get(d.id) ?? ""}` });
    }
    console.log("[search] 索引重建完成");
  } catch (e) {
    console.warn("[search] 索引重建失败", e);
  }
}

export interface SearchHit {
  entityType: SearchEntityType;
  entityId: string;
  projectId: string;
  title: string;
  snippet: string;
}

/** 全局搜索：注入可见项目过滤 */
export async function globalSearch(q: string, visibleIds: string[] | null): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 1) return [];

  if (await ensureSearchIndex()) {
    try {
      const projectFilter =
        visibleIds === null
          ? ""
          : visibleIds.length === 0
            ? "AND 1=0"
            : `AND (projectId IN (${visibleIds.map(() => "?").join(",")}) OR projectId = '')`;
      // trigram 至少 3 字符；短查询退化为前缀/子串 OR 条件
      const matchExpr = query.length >= 3 ? `"${query.replace(/"/g, '""')}"` : null;
      const sql = matchExpr
        ? `SELECT entityType, entityId, projectId, title, snippet(search_index, 4, '<b>', '</b>', '…', 24) AS snippet
           FROM search_index WHERE search_index MATCH ? ${projectFilter} LIMIT 40`
        : `SELECT entityType, entityId, projectId, title, substr(body, 1, 80) AS snippet
           FROM search_index WHERE (title LIKE ? OR body LIKE ?) ${projectFilter} LIMIT 40`;
      const params: unknown[] = matchExpr
        ? [matchExpr, ...(visibleIds ?? [])]
        : [`%${query}%`, `%${query}%`, ...(visibleIds ?? [])];
      const rows = await prisma.$queryRawUnsafe<SearchHit[]>(sql, ...params);
      return rows;
    } catch (e) {
      console.warn("[search] FTS 查询失败，降级 LIKE", e);
    }
  }

  // LIKE 降级
  const like = `%${query}%`;
  const pidFilter = visibleIds === null ? {} : { projectId: { in: visibleIds } };
  const [tasks, boms, specs, ecos, docs] = await Promise.all([
    prisma.task.findMany({ where: { ...pidFilter, title: { contains: query } }, take: 10 }),
    prisma.bomItem.findMany({ where: { ...pidFilter, OR: [{ mpn: { contains: query } }, { name: { contains: query } }] }, take: 10 }),
    prisma.techSpec.findMany({ where: { ...pidFilter, metricName: { contains: query } }, take: 10 }),
    prisma.changeLog.findMany({ where: { ...pidFilter, OR: [{ ecoNumber: { contains: query } }, { description: { contains: query } }] }, take: 10 }),
    prisma.document.findMany({ where: { title: { contains: query } }, take: 10 }),
  ]);
  return [
    ...tasks.map((r): SearchHit => ({ entityType: "TASK", entityId: r.id, projectId: r.projectId, title: r.title, snippet: r.description ?? "" })),
    ...boms.map((r): SearchHit => ({ entityType: "BOM_ITEM", entityId: r.id, projectId: r.projectId, title: `${r.mpn} ${r.name}`, snippet: r.spec ?? "" })),
    ...specs.map((r): SearchHit => ({ entityType: "TECH_SPEC", entityId: r.id, projectId: r.projectId, title: r.metricName, snippet: `目标 ${r.targetValue ?? "-"} / 实测 ${r.actualValue ?? "-"}` })),
    ...ecos.map((r): SearchHit => ({ entityType: "ECO", entityId: r.id, projectId: r.projectId, title: r.ecoNumber, snippet: r.description ?? "" })),
    ...docs.map((r): SearchHit => ({ entityType: "DOCUMENT", entityId: r.id, projectId: r.projectId ?? "", title: r.title, snippet: r.summary ?? "" })),
  ];
}
