import { Prisma, PrismaClient } from "@prisma/client";

type IndexSpec = {
  name: string;
  table: string;
  columns: readonly string[];
  sql: string;
};

type ExistingIndex = {
  index_name: string;
  table_name: string;
  is_valid: boolean;
  is_ready: boolean;
  columns: string[];
};

const INDEXES: readonly IndexSpec[] = [
  {
    name: "Users_primary_org_unit_id_idx",
    table: "Users",
    columns: ["primary_org_unit_id"],
    sql: 'CREATE INDEX CONCURRENTLY "Users_primary_org_unit_id_idx" ON "Users"("primary_org_unit_id")',
  },
  {
    name: "Users_position_id_idx",
    table: "Users",
    columns: ["position_id"],
    sql: 'CREATE INDEX CONCURRENTLY "Users_position_id_idx" ON "Users"("position_id")',
  },
  {
    name: "Users_manager_id_idx",
    table: "Users",
    columns: ["manager_id"],
    sql: 'CREATE INDEX CONCURRENTLY "Users_manager_id_idx" ON "Users"("manager_id")',
  },
  {
    name: "Audit_Logs_project_id_created_at_idx",
    table: "Audit_Logs",
    columns: ["project_id", "created_at"],
    sql: 'CREATE INDEX CONCURRENTLY "Audit_Logs_project_id_created_at_idx" ON "Audit_Logs"("project_id", "created_at")',
  },
  {
    name: "Audit_Logs_correlation_id_idx",
    table: "Audit_Logs",
    columns: ["correlation_id"],
    sql: 'CREATE INDEX CONCURRENTLY "Audit_Logs_correlation_id_idx" ON "Audit_Logs"("correlation_id")',
  },
] as const;

function requireApprovedTarget(): { databaseName: string; host: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL；拒绝猜测目标数据库");
  }

  const parsedUrl = new URL(databaseUrl);
  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL 必须是 PostgreSQL 连接串");
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  const approvedTarget = process.env.AGENT_INDEX_TARGET_ACK;
  if (!databaseName || approvedTarget !== databaseName) {
    throw new Error("AGENT_INDEX_TARGET_ACK 必须与 DATABASE_URL 中的数据库名完全一致");
  }

  return { databaseName, host: parsedUrl.hostname };
}

async function inspectIndex(prisma: PrismaClient, indexName: string): Promise<ExistingIndex | null> {
  const rows = await prisma.$queryRaw<ExistingIndex[]>(Prisma.sql`
    SELECT
      index_class.relname AS index_name,
      table_class.relname AS table_name,
      index_meta.indisvalid AS is_valid,
      index_meta.indisready AS is_ready,
      ARRAY(
        SELECT attribute.attname
        FROM unnest(index_meta.indkey) WITH ORDINALITY AS index_key(attnum, position)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = index_meta.indrelid
         AND attribute.attnum = index_key.attnum
        ORDER BY index_key.position
      ) AS columns
    FROM pg_index AS index_meta
    JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    JOIN pg_class AS table_class ON table_class.oid = index_meta.indrelid
    JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = current_schema()
      AND index_class.relname = ${indexName}
  `);
  return rows[0] ?? null;
}

function assertMatchingIndex(spec: IndexSpec, existing: ExistingIndex): void {
  if (!existing.is_valid || !existing.is_ready) {
    throw new Error(`索引 ${spec.name} 存在但无效；请按迁移说明核对后只清理该 invalid index`);
  }
  if (existing.table_name !== spec.table || existing.columns.join("\0") !== spec.columns.join("\0")) {
    throw new Error(`索引 ${spec.name} 已存在但表名或列顺序不匹配，拒绝覆盖`);
  }
}

async function main(): Promise<void> {
  const target = requireApprovedTarget();
  const prisma = new PrismaClient();
  console.log(`[agent-indexes] 已确认目标 ${target.host}/${target.databaseName}，共 ${INDEXES.length} 个在线索引`);

  try {
    for (const spec of INDEXES) {
      const existing = await inspectIndex(prisma, spec.name);
      if (existing) {
        assertMatchingIndex(spec, existing);
        console.log(`[agent-indexes] 已存在且有效：${spec.name}`);
        continue;
      }

      console.log(`[agent-indexes] 创建：${spec.name}`);
      await prisma.$executeRawUnsafe(spec.sql);
      const created = await inspectIndex(prisma, spec.name);
      if (!created) throw new Error(`索引 ${spec.name} 执行后仍不存在`);
      assertMatchingIndex(spec, created);
    }
    console.log(`[agent-indexes] 完成：${INDEXES.length}/${INDEXES.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[agent-indexes] 失败", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
