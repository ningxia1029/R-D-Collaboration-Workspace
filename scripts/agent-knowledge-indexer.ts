import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/prisma";
import { backfillKnowledgeIndex, processKnowledgeOutboxBatch } from "../src/lib/agent/knowledge/indexer";

const once = process.argv.includes("--once");
const backfill = process.argv.includes("--backfill");
const intervalMs = Math.max(500, Math.min(Number(process.env.AGENT_KNOWLEDGE_POLL_MS ?? 2_000), 60_000));
const batchSize = Math.max(1, Math.min(Number(process.env.AGENT_KNOWLEDGE_BATCH_SIZE ?? 25), 100));
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function main() {
  if (backfill) {
    const result = await backfillKnowledgeIndex({ batchSize: Math.max(batchSize, 100) });
    console.log(`[agent-knowledge] 回填完成 documents=${result.documents} chunks=${result.chunks}`);
  }

  do {
    const result = await processKnowledgeOutboxBatch({ limit: batchSize });
    if (result.claimed || once) {
      console.log(
        `[agent-knowledge] claimed=${result.claimed} processed=${result.processed} failed=${result.failed} dead=${result.dead} chunks=${result.chunksWritten}`,
      );
    }
    if (once || stopping) break;
    await delay(result.claimed >= batchSize ? 0 : intervalMs);
  } while (!stopping);
}

main()
  .catch((error: unknown) => {
    console.error("[agent-knowledge] 运行失败", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
