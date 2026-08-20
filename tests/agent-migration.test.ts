import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FOUNDATION_PATH = resolve(
  process.cwd(),
  "prisma/migrations/20260812000000_agent_governance_foundation/migration.sql",
);
const ONLINE_INDEX_PATH = resolve(
  process.cwd(),
  "prisma/migrations/20260812001000_agent_existing_table_indexes/migration.sql",
);
const ONLINE_INDEX_SCRIPT_PATH = resolve(process.cwd(), "scripts/apply-agent-online-indexes.ts");
const KNOWLEDGE_CHUNK_PATH = resolve(
  process.cwd(),
  "prisma/migrations/20260813000000_agent_knowledge_chunks/migration.sql",
);
const RESOURCE_PLANNING_PATH = resolve(
  process.cwd(),
  "prisma/migrations/20260813001000_resource_planning/migration.sql",
);
const ACTION_CONTROL_PATH = resolve(
  process.cwd(),
  "prisma/migrations/20260813002000_agent_action_control/migration.sql",
);

const foundationSql = readFileSync(FOUNDATION_PATH, "utf8");
const onlineIndexSql = readFileSync(ONLINE_INDEX_PATH, "utf8");
const onlineIndexScript = readFileSync(ONLINE_INDEX_SCRIPT_PATH, "utf8");
const knowledgeChunkSql = readFileSync(KNOWLEDGE_CHUNK_PATH, "utf8");
const resourcePlanningSql = readFileSync(RESOURCE_PLANNING_PATH, "utf8");
const actionControlSql = readFileSync(ACTION_CONTROL_PATH, "utf8");

function executableLines(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

test("阶段 1 基础迁移是 expand-only，不包含顶层数据改写或破坏性语句", () => {
  const executableSql = executableLines(foundationSql);
  assert.doesNotMatch(executableSql, /^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|DROP)\b/im);
  assert.match(executableSql, /ALTER TABLE "Users"[\s\S]*ADD COLUMN "primary_org_unit_id" TEXT,/);
  assert.match(executableSql, /ADD COLUMN "weekly_capacity_hours" DOUBLE PRECISION,/);
  assert.doesNotMatch(executableSql, /ADD COLUMN "(?:primary_org_unit_id|position_id|manager_id|weekly_capacity_hours)"[^,;]*NOT NULL/);
  assert.match(executableSql, /ALTER TABLE "Audit_Logs"[\s\S]*ADD COLUMN "metadata_json" TEXT;/);
});

test("阶段 1 数据库约束覆盖状态、非负指标、自管理和外键删除语义", () => {
  assert.match(foundationSql, /CONSTRAINT "Agent_Runs_status_check" CHECK/);
  assert.match(foundationSql, /CONSTRAINT "Users_manager_not_self_check"/);
  assert.match(foundationSql, /CONSTRAINT "Users_weekly_capacity_hours_check"/);
  assert.match(foundationSql, /CONSTRAINT "Outbox_Events_attempts_nonnegative_check"/);
  assert.match(
    foundationSql,
    /"Activity_Events_project_id_fkey"[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE;/,
  );
});

test("Agent 幂等键和事件序列均由唯一索引保护", () => {
  assert.match(foundationSql, /CREATE UNIQUE INDEX "Agent_Runs_idempotency_key_key"/);
  assert.match(foundationSql, /CREATE UNIQUE INDEX "Agent_Tool_Executions_request_id_key"/);
  assert.match(foundationSql, /CREATE UNIQUE INDEX "Outbox_Events_dedup_key_key"/);
  assert.match(foundationSql, /CREATE UNIQUE INDEX "Agent_Messages_run_id_sequence_key"/);
  assert.match(foundationSql, /CREATE UNIQUE INDEX "Agent_Run_Events_run_id_sequence_key"/);
});

test("Prisma 清单不在事务中建在线索引，运维脚本固定使用 CONCURRENTLY", () => {
  assert.doesNotMatch(executableLines(onlineIndexSql), /CREATE INDEX/i);
  assert.match(executableLines(onlineIndexSql), /^\s*SELECT 1;/m);

  const concurrentDefinitions = onlineIndexScript.match(/sql: 'CREATE INDEX CONCURRENTLY /g) ?? [];
  assert.equal(concurrentDefinitions.length, 5);
  assert.match(onlineIndexScript, /AGENT_INDEX_TARGET_ACK/);
  assert.match(onlineIndexScript, /is_valid/);
  assert.match(onlineIndexScript, /is_ready/);
});

test("阶段 5 知识迁移只新增派生片段表，并以版本、序号和级联外键约束完整性", () => {
  const executableSql = executableLines(knowledgeChunkSql);
  assert.doesNotMatch(executableSql, /^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|DROP|ALTER\s+TABLE\s+"(?:Documents|Doc_Versions)")\b/im);
  assert.match(executableSql, /CREATE TABLE "Agent_Document_Chunks"/);
  assert.match(executableSql, /"doc_version_id" TEXT NOT NULL/);
  assert.match(executableSql, /"section_path_json" JSONB NOT NULL/);
  assert.match(executableSql, /"prompt_injection_detected" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(executableSql, /Agent_Document_Chunks_doc_version_id_ordinal_key/);
  assert.match(executableSql, /REFERENCES "Documents"\("id"\) ON DELETE CASCADE/);
  assert.match(executableSql, /REFERENCES "Doc_Versions"\("id"\) ON DELETE CASCADE/);
});

test("阶段 6 资源计划迁移区分窗口覆盖与分配，并在数据库层拒绝非法关系", () => {
  assert.match(resourcePlanningSql, /CREATE TABLE "Resource_Plan_Windows"/);
  assert.match(resourcePlanningSql, /CREATE TABLE "Resource_Plan_Allocations"/);
  assert.match(resourcePlanningSql, /Resource_Plan_Windows_date_range_check/);
  assert.match(resourcePlanningSql, /Resource_Plan_Allocations_hours_check/);
  assert.match(resourcePlanningSql, /published resource plan windows must not overlap/);
  assert.match(resourcePlanningSql, /resource plan allocation date is outside its window/);
  assert.match(resourcePlanningSql, /resource plan task assignee must match plan owner/);
  assert.match(resourcePlanningSql, /resource plan allocation exceeds 24 hours per day/);
  assert.doesNotMatch(executableLines(resourcePlanningSql), /^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im);
});

test("阶段 7 迁移只扩展 Agent 审批元数据，并约束一次执行的完整审计结果", () => {
  const executableSql = executableLines(actionControlSql);
  assert.doesNotMatch(executableSql, /^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/im);
  assert.doesNotMatch(executableSql, /ALTER\s+TABLE[\s\S]*DROP\s+COLUMN/i);
  assert.match(actionControlSql, /ADD COLUMN "proposal_hash" TEXT/);
  assert.match(actionControlSql, /ADD COLUMN "approval_nonce_hash" TEXT/);
  assert.match(actionControlSql, /ADD COLUMN "execution_idempotency_key" TEXT/);
  assert.match(actionControlSql, /Agent_Approval_Requests_execution_complete_check/);
  assert.match(actionControlSql, /Agent_Approval_Requests_execution_idempotency_key_key/);
  assert.match(actionControlSql, /'CONFLICT', 'FAILED'/);
});
