# 2026-08-12 Agent 治理基础迁移说明

## 范围

对应以下迁移：

1. `20260812000000_agent_governance_foundation`
2. `20260812001000_agent_existing_table_indexes`

这是 expand-only 变更：现有 `Users`、`Audit_Logs` 只增加 nullable 列；新增组织、Agent Run/Tool/Checkpoint/Approval/Feedback、活动事件和 Outbox 表。迁移不包含历史数据回填，不修改已有业务行。

## 前置检查

```powershell
npx prisma validate
npx prisma migrate status
```

- 只允许对隔离恢复库、开发库或经明确批准的目标执行。
- 禁止使用 `npm run setup`、`db:push` 或 seed 代替迁移。
- 先确认数据库已经应用 baseline 与 operational indexes 两个历史迁移。
- 记录目标库标识、备份时间、迁移前行数和 `_prisma_migrations` 状态；不要把连接串写入日志。

## 应用

```powershell
npx prisma migrate deploy
npx prisma migrate status
$env:AGENT_INDEX_TARGET_ACK = '<目标数据库名>'
npm run db:agent-indexes
$env:AGENT_DB_VERIFY_TARGET_ACK = '<隔离验收数据库名>'
$env:AGENT_DB_VERIFY_ALLOW_DESTRUCTIVE = '1'
npm run db:agent-verify
```

Prisma 5.22 会在事务中执行 migration，不能直接承载 `CREATE INDEX CONCURRENTLY`。因此第二个 migration 只记录在线索引清单，`db:agent-indexes` 在自动提交模式下逐个创建五个索引。命令要求 `AGENT_INDEX_TARGET_ACK` 与连接串中的数据库名完全一致，并在创建前后核对表名、列顺序、`indisvalid` 和 `indisready`。

若连接中断，脚本会拒绝复用 invalid index。先查询 `pg_index.indisvalid`；只删除本阶段创建且 `indisvalid = false` 的精确索引，再重新执行，不得泛化删除其他索引。

`db:agent-verify` 会写入并清理临时验收记录，用于触发数据库约束负例和级联删除；它只能在可丢弃的隔离库执行，禁止用于业务库或生产库。

## 数据回填策略

- `Users.primary_org_unit_id/position_id/manager_id/weekly_capacity_hours` 保持 NULL，直至组织管理员导入并校验数据。
- 历史 `Audit_Logs` 的 `project_id/correlation_id/event_type/metadata_json` 保持 NULL；不得根据 `entity_id` 猜测回填。
- Agent、Activity、Outbox 新表没有历史回填。
- 组织数据导入属于单独、可审计的数据迁移，需先验证组织无环、经理非本人和周产能 0–168 小时。

## 验收 SQL

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'Org_Units', 'Positions', 'Agent_Runs', 'Agent_Messages',
    'Agent_Run_Events', 'Agent_Tool_Executions', 'Agent_Checkpoints',
    'Agent_Feedback', 'Agent_Approval_Requests', 'Activity_Events', 'Outbox_Events'
  )
ORDER BY table_name;

SELECT indexrelid::regclass AS index_name, indisvalid, indisready
FROM pg_index
WHERE indexrelid::regclass::text IN (
  '"Users_primary_org_unit_id_idx"',
  '"Users_position_id_idx"',
  '"Users_manager_id_idx"',
  '"Audit_Logs_project_id_created_at_idx"',
  '"Audit_Logs_correlation_id_idx"'
);
```

同时执行应用层 schema、单测、类型检查和生产构建。只有数据库前滚、约束负例和 Prisma drift 检查都通过，阶段 1 才能关闭。

## 回滚与前滚修复

Prisma 生产迁移采用 forward-only。若迁移已经用于共享或生产环境，不编辑既有 migration，也不直接执行下方破坏性 SQL；应创建新的补偿迁移并先备份。

仅在一次性隔离验收库、确认没有 Agent/组织新数据且明确需要恢复旧 schema 时，可按逆序：

1. 删除 `db:agent-indexes` 创建的 5 个索引；
2. 删除 Agent/Outbox/Activity 表（先子表后父表）；
3. 删除 `Org_Units`/`Positions` 外键与表；
4. 从 `Users`、`Audit_Logs` 删除本次新增列。

该回滚会永久删除新表数据，因此不提供自动脚本，也不得对名称或目标库不明确的环境执行。

## 不能由本迁移证明的事项

- 组织数据完整性和公司真实组织规则；
- 生产规模下的锁等待、索引耗时和磁盘增长；
- Agent Runtime、Tool、SSE 或 Action Agent 已实现；
- 审计保留期限、模型数据驻留和生产合规已经批准。
