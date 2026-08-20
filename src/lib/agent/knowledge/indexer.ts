import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const AGENT_KNOWLEDGE_INDEX_VERSION = "document_lexical_v2";
export const KNOWLEDGE_CHUNK_MAX_CHARS = 1_200;
const KNOWLEDGE_CHUNK_OVERLAP_CHARS = 120;
const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_LEASE_MS = 5 * 60_000;

export interface KnowledgeChunkDraft {
  ordinal: number;
  sectionPath: string[];
  contentText: string;
  contentHash: string;
  promptInjectionDetected: boolean;
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)/i,
  /(?:system|developer)\s+(?:prompt|message|instructions?)/i,
  /(?:reveal|export|print|show).{0,40}(?:password|secret|token|credential|api\s*key)/i,
  /(?:call|invoke|enable|disable).{0,30}(?:tool|function|allowlist)/i,
  /忽略.{0,20}(?:此前|之前|以上|系统).{0,20}(?:指令|规则|提示)/i,
  /(?:系统|开发者)(?:提示|消息|指令)/i,
  /(?:导出|泄露|显示).{0,30}(?:密码|密钥|令牌|凭据)/i,
  /(?:调用|启用|停用).{0,20}(?:工具|白名单)/i,
] as const;

function clip(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

export function detectPromptInjection(content: string): boolean {
  const normalized = content.replace(/\s+/g, " ").trim();
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function chunkHash(contentText: string, sectionPath: string[]): string {
  return createHash("sha256").update(JSON.stringify({ contentText, sectionPath }), "utf8").digest("hex");
}

function splitUnicodeWithOverlap(value: string): string[] {
  const chars = Array.from(value);
  if (chars.length <= KNOWLEDGE_CHUNK_MAX_CHARS) return [value];
  const chunks: string[] = [];
  let start = 0;
  while (start < chars.length) {
    const end = Math.min(chars.length, start + KNOWLEDGE_CHUNK_MAX_CHARS);
    const chunk = chars.slice(start, end).join("").trim();
    if (chunk) chunks.push(chunk);
    if (end >= chars.length) break;
    start = Math.max(start + 1, end - KNOWLEDGE_CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

/** 按 Markdown 标题路径确定性分块；不解释或执行文档中的任何命令。 */
export function splitMarkdownIntoKnowledgeChunks(contentMd: string): KnowledgeChunkDraft[] {
  const sections: Array<{ sectionPath: string[]; lines: string[] }> = [];
  const headingStack: string[] = [];
  let current: { sectionPath: string[]; lines: string[] } = { sectionPath: [], lines: [] };
  const flush = () => {
    const body = current.lines.join("\n").trim();
    if (body) sections.push({ sectionPath: current.sectionPath, lines: [body] });
  };

  for (const line of contentMd.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    flush();
    const level = heading[1].length;
    headingStack.splice(level - 1);
    headingStack[level - 1] = clip(heading[2].trim(), 200);
    current = { sectionPath: headingStack.filter(Boolean), lines: [] };
  }
  flush();

  const drafts: KnowledgeChunkDraft[] = [];
  for (const section of sections) {
    const headingContext = section.sectionPath.length ? `${section.sectionPath.join(" > ")}\n` : "";
    const source = `${headingContext}${section.lines.join("\n")}`.trim();
    for (const contentText of splitUnicodeWithOverlap(source)) {
      const sectionPath = [...section.sectionPath];
      drafts.push({
        ordinal: drafts.length,
        sectionPath,
        contentText,
        contentHash: chunkHash(contentText, sectionPath),
        promptInjectionDetected: detectPromptInjection(contentText),
      });
    }
  }
  return drafts;
}

function stableChunkId(documentId: string, docVersionId: string, ordinal: number): string {
  const digest = createHash("sha256")
    .update(`${AGENT_KNOWLEDGE_INDEX_VERSION}:${documentId}:${docVersionId}:${ordinal}`, "utf8")
    .digest("hex");
  return `adc_${digest.slice(0, 40)}`;
}

export async function replaceDocumentChunks(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<{ documentId: string; version: number | null; chunkCount: number; deleted: boolean }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-document:${documentId}`}))`;
  const document = await tx.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      summary: true,
      projectId: true,
      updatedAt: true,
      versions: {
        select: { id: true, version: true, contentMd: true },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });
  await tx.agentDocumentChunk.deleteMany({ where: { documentId } });
  if (!document) return { documentId, version: null, chunkCount: 0, deleted: true };

  const latest = document.versions[0];
  if (!latest) return { documentId, version: null, chunkCount: 0, deleted: false };
  const fallback = [document.title, document.summary].filter(Boolean).join("\n");
  const chunks = splitMarkdownIntoKnowledgeChunks(latest.contentMd.trim() || fallback);
  if (chunks.length) {
    await tx.agentDocumentChunk.createMany({
      data: chunks.map((chunk) => ({
        id: stableChunkId(document.id, latest.id, chunk.ordinal),
        documentId: document.id,
        docVersionId: latest.id,
        projectId: document.projectId,
        ordinal: chunk.ordinal,
        sectionPathJson: chunk.sectionPath,
        contentText: chunk.contentText,
        contentHash: chunk.contentHash,
        indexVersion: AGENT_KNOWLEDGE_INDEX_VERSION,
        promptInjectionDetected: chunk.promptInjectionDetected,
        sourceUpdatedAt: document.updatedAt,
      })),
    });
  }
  return { documentId, version: latest.version, chunkCount: chunks.length, deleted: false };
}

export async function reindexDocumentNow(
  documentId: string,
  client: Pick<PrismaClient, "$transaction"> = prisma,
) {
  return client.$transaction((tx) => replaceDocumentChunks(tx, documentId));
}

async function processClaimedEvent(eventId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== "PROCESSING") return 0;
    const result = await replaceDocumentChunks(tx, event.aggregateId);
    const completed = await tx.outboxEvent.updateMany({
      where: { id: event.id, status: "PROCESSING" },
      data: { status: "PROCESSED", processedAt: new Date(), lockedAt: null, lastError: null },
    });
    if (completed.count !== 1) throw new Error("Outbox 状态已变化，拒绝重复确认");
    return result.chunkCount;
  });
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

export interface KnowledgeOutboxBatchResult {
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
  chunksWritten: number;
}

/** 可多实例运行的有限批次消费者；通过条件更新抢占，并回收过期 PROCESSING 租约。 */
export async function processKnowledgeOutboxBatch(options: { limit?: number; now?: Date } = {}): Promise<KnowledgeOutboxBatchResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);
  const candidates = await prisma.outboxEvent.findMany({
    where: {
      aggregateType: "DOCUMENT",
      eventType: { in: ["DOCUMENT_INDEX_UPSERT", "DOCUMENT_INDEX_DELETE"] },
      availableAt: { lte: now },
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", lockedAt: { lte: staleBefore } },
      ],
    },
    select: { id: true, status: true, lockedAt: true },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: limit * 3,
  });
  const result: KnowledgeOutboxBatchResult = { claimed: 0, processed: 0, failed: 0, dead: 0, chunksWritten: 0 };

  for (const candidate of candidates) {
    if (result.claimed >= limit) break;
    const claimed = await prisma.outboxEvent.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.status === "PROCESSING" ? { lockedAt: candidate.lockedAt } : {}),
      },
      data: { status: "PROCESSING", attempts: { increment: 1 }, lockedAt: now, lastError: null },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;
    try {
      result.chunksWritten += await processClaimedEvent(candidate.id);
      result.processed += 1;
    } catch (error) {
      const current = await prisma.outboxEvent.findUnique({ where: { id: candidate.id }, select: { attempts: true } });
      const attempts = current?.attempts ?? OUTBOX_MAX_ATTEMPTS;
      const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
      await prisma.outboxEvent.updateMany({
        where: { id: candidate.id, status: "PROCESSING" },
        data: {
          status: dead ? "DEAD" : "FAILED",
          lockedAt: null,
          lastError: clip(error instanceof Error ? error.message : "未知索引错误", 500),
          availableAt: new Date(now.getTime() + retryDelayMs(attempts)),
        },
      });
      if (dead) result.dead += 1;
      else result.failed += 1;
    }
  }
  return result;
}

export async function backfillKnowledgeIndex(options: { batchSize?: number } = {}): Promise<{ documents: number; chunks: number }> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 500));
  let cursor: string | undefined;
  let documents = 0;
  let chunks = 0;
  for (;;) {
    const rows = await prisma.document.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: batchSize,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const indexed = await reindexDocumentNow(row.id);
      documents += 1;
      chunks += indexed.chunkCount;
    }
    cursor = rows.at(-1)!.id;
    if (rows.length < batchSize) break;
  }
  return { documents, chunks };
}
