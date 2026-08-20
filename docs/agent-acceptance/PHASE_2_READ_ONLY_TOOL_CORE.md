# 阶段 2：只读 PLM Tool Core 验收记录

| 属性 | 结果 |
|---|---|
| 验收日期 | 2026-08-12 |
| 阶段结论 | **通过** |
| 验收范围 | 单一 Zod/JSON Schema、8 个只读 Tool、Gateway、RBAC、证据、分页、内部/MCP Adapter、Agent Tool 审计 |
| 数据库环境 | WSL2 Ubuntu 22.04，PostgreSQL 14.23，临时库 `workbuddy_agent_phase2`，临时端口 `55440` |
| 业务库影响 | **无**；集成夹具只写入并清理可丢弃验收库 |

## 1. 已交付

- `src/lib/agent/tools/contracts.ts`：12 个已批准 Tool 名称、8 个 MVP 严格输入/输出 Schema、公共 envelope 和 JSON Schema 生成。
- `registry.ts`：8 个启用 Tool 和 4 个 `data_not_ready` Tool 的单一注册表，所有副作用声明为 `none`。
- `gateway.ts`：受信上下文、动态身份/权限、严格校验、HMAC cursor、超时、统一错误、输出回验和审计 fail-closed。
- `prismaDataSource.ts`：项目、任务、依赖、里程碑、BOM、ECR/ECO、文档的受控只读查询和确定性计算。
- `production.ts`：每次调用重读账号/角色/项目成员，Agent Tool 审计只保存哈希和摘要，不保存原始输入。
- `adapters.ts`：内部 Adapter 与 MCP 映射复用同一 Gateway/Schema/Handler。
- `verify-agent-tools-db.ts`：带目标确认和隔离库限制的四角色、权限撤销、无副作用验收工具。

## 2. 自动化验收

| 验收层 | 命令/动作 | 结果 |
|---|---|---|
| 单元/契约 | `npm run test` | **29/29 通过**；其中阶段 2 新增 12 个 Tool Core 场景 |
| 类型 | `npm run typecheck -- --incremental false` | 通过 |
| Schema | `npx prisma validate` | 通过 |
| 生产构建 | `npm run build` | 通过，静态页面 **39/39** |
| Diff | `git diff --check` | 退出码 0；只有既有 LF→CRLF 提示 |
| 数据库准备 | 全量 `migrate deploy` + `db:agent-indexes` | 4/4 migration、5/5 在线索引成功 |
| 四角色矩阵 | `npm run db:agent-tools-verify` | admin/pm/engineer/viewer × 8 Tool = **32/32** 成功 |
| 非成员边界 | 同一集成验收 | 项目摘要拒绝；项目不可枚举；文档仅返回公共文档 |
| 动态鉴权 | 同一集成验收 | 停用账号立即拒绝；删除成员关系后项目文档立即不可检索 |
| 无副作用 | 调用前后 22 类业务表序列化快照 | **完全一致** |
| 审计 | Agent Tool execution | **37/37** 有记录；原始 input 未保存 |
| 清理 | 删除临时库/目录并停止端口 | `PHASE2_CLEANUP_OK` |

## 3. 关键确定性断言

- 项目进度固定为 `Done / total` 任务行数，返回 `progress_is_task_count_based`。
- `project_health_v1`：阻塞或逾期为 red；否则延迟 BOM 为 yellow；否则 green。
- 任务与里程碑逾期使用执行快照 `asOf`；日期条件按 IANA 时区转换。
- BOM 齐套率保持 Arrived 行数 / 总行数，返回 `kit_rate_is_row_based`。
- cursor 由 Tool 名、去除 cursor 后的筛选指纹和最后 ID 签名；篡改或跨筛选复用被拒绝。
- 文档只从最新版生成不超过 500 Unicode 字符的片段；`hybrid` 未启用时明确失败。
- 模型输入无法提交 `userId/role/projectIds/permissionCodes/sql/where` 等控制字段。
- Tool 失败只返回稳定错误码和通用消息；SQL、堆栈、内部路径不进入响应或 Agent 审计摘要。

## 4. 验收边界与保留风险

- MCP Adapter 已验证结构和执行等价，但尚未启动独立 MCP 网络服务；阶段 3 Runtime 先使用内部 Adapter。
- PostgreSQL 集成使用 14.23 和小型确定性夹具，不代表生产数据量、PostgreSQL 16 或 P95 性能。
- 文档检索为受控 lexical 基线；没有向量索引、召回率评测或持久 chunk 表，这些属于阶段 5。
- Tool 超时和可重试错误已验证；Run 租约、取消、恢复、重试预算和 Provider 故障属于阶段 3。
- 业务表无副作用不包含预期的 `Agent_Tool_Executions` 审计写入；审计是治理数据，不是业务实体写入。
- Node 20 兼容、依赖漏洞和干净 HEAD/正式发布证据仍未关闭。
