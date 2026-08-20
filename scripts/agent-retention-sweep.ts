import { PrismaClient } from "@prisma/client";

const CONFIG = {
  batchSize: 100,
  terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
} as const;

const prisma = new PrismaClient();

function targetDatabaseName(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("缺少 DATABASE_URL；拒绝猜测保留策略目标");
  const parsed = new URL(raw);
  if (!/^(postgresql|postgres):$/.test(parsed.protocol)) throw new Error("DATABASE_URL 必须是 PostgreSQL");
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name || process.env.AGENT_RETENTION_TARGET_ACK !== name) {
    throw new Error("AGENT_RETENTION_TARGET_ACK 必须与目标数据库名完全一致");
  }
  return name;
}

async function main(): Promise<void> {
  const databaseName = targetDatabaseName();
  const apply = process.argv.includes("--apply");
  const now = new Date();
  const candidates = await prisma.agentRun.findMany({
    where: {
      status: { in: [...CONFIG.terminalStatuses] },
      retentionUntil: { lte: now },
    },
    select: { id: true, status: true, retentionUntil: true, containsSensitiveData: true },
    orderBy: [{ retentionUntil: "asc" }, { id: "asc" }],
    take: CONFIG.batchSize,
  });
  console.log(`[agent-retention] target=${databaseName} mode=${apply ? "apply" : "dry-run"} as_of=${now.toISOString()} candidates=${candidates.length}`);
  console.log(JSON.stringify(candidates, null, 2));
  if (!apply || candidates.length === 0) return;
  if (process.env.AGENT_RETENTION_APPLY_ACK !== `DELETE ${candidates.length} EXPIRED AGENT RUNS`) {
    throw new Error(`执行删除必须设置 AGENT_RETENTION_APPLY_ACK='DELETE ${candidates.length} EXPIRED AGENT RUNS'`);
  }
  const ids = candidates.map((candidate) => candidate.id);
  const deleted = await prisma.agentRun.deleteMany({
    where: {
      id: { in: ids },
      status: { in: [...CONFIG.terminalStatuses] },
      retentionUntil: { lte: now },
    },
  });
  if (deleted.count !== ids.length) throw new Error(`并发状态变化：候选 ${ids.length}，实际删除 ${deleted.count}`);
  console.log(`[agent-retention] deleted=${deleted.count}; Agent 子表通过外键级联清理，业务审计与业务事实不在本脚本范围内`);
}

main()
  .catch((error: unknown) => {
    console.error(`[agent-retention] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
