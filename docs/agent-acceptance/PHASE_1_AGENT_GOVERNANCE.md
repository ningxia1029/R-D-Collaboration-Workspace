# 阶段 1：Agent-ready 数据与治理模型验收记录

| 属性 | 结果 |
|---|---|
| 验收日期 | 2026-08-12 |
| 阶段结论 | **通过** |
| 验收范围 | Prisma schema、迁移、组织/Run/审计/活动/Outbox 模型、约束、在线索引与恢复前滚 |
| 隔离环境 | WSL2 Ubuntu 22.04，PostgreSQL 14.23，临时库 `workbuddy_agent_phase1`，临时端口 `55439` |
| 业务库影响 | **无**；所有迁移和数据库负例只在临时实例执行 |

## 1. 已交付

- `OrgUnit`、`Position` 以及用户主部门、岗位、直属经理、周标准产能字段。
- `AgentRun`、消息、事件流、Tool 执行、Checkpoint、Feedback、Approval 数据模型。
- `ActivityEvent` 事实流和 `OutboxEvent` 事务事件模型。
- 通用审计的 project/correlation/event/metadata 字段与递归脱敏、裁剪逻辑。
- Agent Run 显式状态机、组织无环/自管理/产能应用层校验。
- expand-only Prisma migration、在线索引幂等工具、隔离库数据库负例工具和迁移运维说明。

## 2. 验收证据

| 验收层 | 命令/动作 | 结果 |
|---|---|---|
| Schema | `npx prisma format`、`npx prisma validate`、`npx prisma generate` | 全部成功；Prisma 5.22.0 Client 生成成功 |
| 单元/静态门禁 | `npm run test` | **16/16 通过**；含 6 个治理测试、4 个迁移测试和原有测试 |
| 类型 | `npm run typecheck -- --incremental false` | 通过 |
| 全量迁移 | 临时环境变量下执行 `npx prisma migrate deploy` | baseline 至阶段 1 共 **4/4** migration 成功应用 |
| 在线索引 | `npm run db:agent-indexes` | 首次创建 **5/5**；第二次执行识别 **5/5** 已存在且有效 |
| 目标保护 | 使用错误 `AGENT_INDEX_TARGET_ACK` 执行 | 以退出码 1 确定性拒绝，未连接错误目标 |
| 迁移状态 | `npx prisma migrate status` | `Database schema is up to date!` |
| Drift | `npx prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code` | `No difference detected.` |
| 数据库负例 | `npm run db:agent-verify` | 7 类非法数据均由 PostgreSQL 拒绝 |
| 外键语义 | 同一数据库负例工具 | Project 删除后 Activity 保留且 `projectId = null`；Run 的 6 类子记录全部级联清理 |
| 数据库清单 | 验收 SQL | PostgreSQL 14.23；4 个 migration；11 个 Agent/组织/事件表；5 个在线索引 valid/ready |
| 生产构建 | `npm run build` | 成功编译并生成静态页面 **39/39** |
| Diff 基础检查 | `git diff --check` | 退出码 0；仅报告既有 LF→CRLF 提示 |

数据库负例覆盖：负产能、自我经理、组织自引用、非法 Run 状态、重复 Run 幂等键、重复消息序号、负 Outbox 重试次数。

## 3. 验收中发现并关闭的问题

首次真实前滚在第四个 migration 失败：PostgreSQL 返回 `25001`，原因是 Prisma 5.22 在事务内执行 migration，而 `CREATE INDEX CONCURRENTLY` 禁止在事务块内运行。

修正方式：

1. Prisma migration 只保留在线索引清单，不在事务内创建索引；
2. `db:agent-indexes` 逐个以自动提交执行 `CREATE INDEX CONCURRENTLY`；
3. 脚本要求目标数据库名二次确认，并验证索引表名、列顺序、`indisvalid`、`indisready`；
4. 删除并重建精确命名的可丢弃验收库后，从空库重新前滚，4/4 成功；在线索引与 drift 验收随后通过。

这证明失败迁移的隔离恢复和重新前滚路径可行；没有对共享或生产库执行破坏性回滚。

## 4. 数据安全与边界

- 未运行 `npm run setup`、`db:push`、seed 或业务数据回填。
- 未使用项目 `.env` 的数据库作为验收目标；连接串只作为单命令进程环境变量。
- 验收后已删除精确命名的临时数据库与临时数据目录、停止临时 PostgreSQL 端口，并恢复 Docker Desktop 为停止状态；WSL 中保留 PostgreSQL 14 工具链供后续隔离验收复用。
- 数据库验证工具要求数据库名匹配与显式 destructive 开关，且只允许在隔离库使用。
- 审计 metadata/diff 会对密钥、密码、token、cookie、连接串等键脱敏，并限制深度、数组、键和字符串长度。
- Agent Runtime、Tool、UI、知识检索与写动作不属于本阶段，不能由本记录证明已实现。

## 5. 仍保留的风险

- 数据库功能验收使用 PostgreSQL 14.23，不代表计划生产版本或生产数据量下的锁等待、耗时和磁盘增长。
- 组织与产能尚无真实业务数据；本阶段只证明 schema 和非法关系拒绝机制。
- 本地 Node 为 24.12.0，而项目目标是 Node 20；阶段 3 必须建立 Node 20 兼容门禁。
- 工作树仍包含此前大量未提交生产加固改动；本次构建不是干净 HEAD 或发布产物证明。
- Phase 0 记录的高危/严重依赖漏洞仍未关闭，不影响本阶段数据模型验收结论，但阻止最终生产发布。
