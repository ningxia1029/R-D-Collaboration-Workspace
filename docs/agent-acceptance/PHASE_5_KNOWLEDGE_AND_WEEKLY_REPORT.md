# 阶段 5 验收记录：权限感知知识检索与研发周报

| 属性 | 内容 |
|---|---|
| 验收日期 | 2026-08-13 |
| 代码目录 | `E:\workbuddy_pro` |
| 验收范围 | 最新版文档片段、ACL 检索、事务 Outbox、提示注入隔离、`ActivityEvent` 周报 |
| 最终运行时 | Node.js 24.12.0；PostgreSQL 14.23 隔离实例 |
| 结论 | **阶段 5 本地工程门禁通过；允许进入阶段 6，不代表生产验收或正式发布** |

## 1. 已实现能力

- 新增 `Agent_Document_Chunks` 派生索引：文档版本、片段序号、标题路径、内容哈希、`indexVersion`、提示注入标记和源更新时间。
- 使用确定性 Markdown 分块，单片段最多 1200 个 Unicode 字符；Tool excerpt 最多 500 字符。
- 文档创建、更新、删除在同一业务事务内写 `ActivityEvent` 和文档索引 Outbox；独立索引器支持有限批次、条件抢占、失败重试、死信阈值、过期租约回收和文档级 advisory lock。
- `plm_document_search` 改用 `document_lexical_v2` 最新版片段；按当前 `Documents.projectId` 和项目成员关系鉴权，不把片段 ACL 快照当作最终授权依据。
- 公共文档策略明确为 `projectId = null`；仍需有效登录和 `kb:read`，且受 `includeShared` 控制。
- 提示注入检测只产生 warning；系统提示、Tool allowlist、委托身份和只读边界不受文档内容影响。
- `plm_report_generate_weekly` 已启用：完成任务与 ECR/ECO 动作只读取时间窗内结构化 `ActivityEvent`；进度、风险、里程碑和 BOM 明确为 `asOf` 当前快照。
- 阶段 6 前工作负载固定为 `null` 并进入 `omittedSections`，不伪造利用率。

## 2. 固定检索评测与阈值

阶段 5 先建立精确关键词基线，不引入 pg_trgm、全文、embedding 或向量检索。

| 指标 | 评审阈值 | 最终结果 | 结论 |
|---|---:|---:|---|
| 固定知识集规模 | 10 条工程知识题 | 10 条 | 通过 |
| Recall@5 | ≥ 0.90 | **1.00** | 通过 |
| 引用支持率 | 1.00 | **1.00** | 通过 |
| 引用版本 | 必须为当前最新版 | 10/10 为 v1；增量用例切换为 v2 | 通过 |

引用支持的判定是：返回项命中预期 `documentId`，`documentVersion` 与证据版本一致，证据 excerpt 与结构化 item 一致。该数据集是精确关键词夹具，不证明同义改写、自然语言语义召回或生产规模效果；不少于 50 条的完整跨场景评测仍保留到阶段 8。

## 3. 权限、注入与索引一致性

- 可见项目成员能召回项目片段；非成员只能召回公共文档；可见用户查询隐藏项目关键词返回空结果。
- 删除项目成员关系后，无需等待索引更新，下一次 Tool 调用立即返回 `resource_not_accessible`。
- 隐藏项目存在待处理 Outbox 时，可见项目用户不会收到 `knowledge_index_lag`，避免由积压数量侧漏隐藏项目元数据。
- 中英文提示注入单元集 4/4 被标记；隔离数据库样本返回结构化 `prompt_injection_pattern_detected` warning，且 Agent Tool 控制策略保持不变。
- 文档更新后、Outbox 消费前返回范围内的 `knowledge_index_lag`；过期 `PROCESSING` 租约成功回收；消费后仅 v2 可召回，v1 正文专属短语不可召回。
- 文档删除后 Outbox 成功消费，派生片段为 0。

## 4. 周报事实边界

- 通过业务服务把一条任务从 `In Progress` 更新为 `Done`，周报完成项 ID 与 `ActivityEvent` 一致，`completedAt` 精确使用 `occurredAt`。
- 另建一条没有结构化完成事件的 `Done` 任务；周报没有把该当前快照任务猜成本周完成。
- ECR 创建/提交事件逐条映射到周报 `changes`；字段不完整的 ECR 活动未纳入结果并返回 warning。
- 无活动事件的历史周返回空完成项/变更项，并在 `omittedSections` 说明未从当前快照补猜。
- 开放任务风险、延迟 BOM、错过/即将到来的里程碑和任务完成率是当前快照；草稿中明确区分“本周活动”和“当前状态”。

## 5. 最终验证命令与结果

| 验证层 | 命令 | 结果 |
|---|---|---|
| Prisma schema | `npx prisma validate` | 通过 |
| TypeScript | `npm run typecheck` | 通过 |
| 全仓自动化 | `npm test` | **55/55 通过** |
| Next.js 生产构建 | `npm run build` | 编译、类型检查、**42/42** 静态页面生成通过 |
| 隔离迁移 | `npx prisma migrate deploy` | **7/7** migrations 通过 |
| 阶段 5 数据门禁 | `npm run db:agent-knowledge-verify` | Outbox 13/13；重复消费 0；检索/ACL/注入/版本/周报全部 PASS |
| 在线索引 | `npm run db:agent-indexes` | **5/5** 创建且 valid/ready |
| 迁移状态 | `npx prisma migrate status` | `Database schema is up to date!` |
| 实际库漂移 | `prisma migrate diff --from-url ... --to-schema-datamodel ... --exit-code` | `No difference detected.` |
| 隔离资源清理 | `manage-agent-knowledge-test-db.sh stop ...` | `PHASE5_CLEANUP_OK`；4 次临时集群路径均不存在 |
| 生产依赖审计 | `npm audit --omit=dev` | **失败：2 critical + 4 high** |

基础 migration 清单故意不包含 5 个 `CREATE INDEX CONCURRENTLY`，因此“migrations → schema”会报告这些既有在线索引差异；按阶段 1 既定双步骤应用 `db:agent-indexes` 后，“实际数据库 → schema”为零漂移。

## 6. 验收中发现并修正的问题

1. 首次隔离演练发现 Prisma 不能反序列化 `pg_advisory_xact_lock()` 的 `void` 返回值；将调用从查询接口改为执行接口后重新建立全新隔离库验证。
2. 第二次演练的旧版本断言使用了仍保留在标题中的关键词，产生假阴性；改为仅存在于 v1 正文的短语后，全新隔离库验证旧片段确已失效。
3. 实现审查发现全局 Outbox 积压计数可能泄露隐藏项目元数据；改为按调用方当前可见范围统计，并新增隐藏项目积压反例。

上述失败轮次不计入通过证据；最终结论只依据修正后的全新 `workbuddy_phase5_final4` 隔离库及最终全仓回归。

## 7. 未验证边界与风险

- 没有对现有业务数据库运行 migration、backfill、seed、`db push` 或 `setup`；生产迁移和初次回填仍需单独审批、备份和恢复门禁。
- 未验证 PostgreSQL 16、生产文档规模、并发索引吞吐、长时间积压、连接池或 P95 性能。
- 未验证真实外部模型对知识/周报的 Tool 选择与文字忠实度；本阶段证明的是确定性 Tool、数据链和 Harness 边界。
- 提示注入检测是辅助告警，不可能覆盖所有攻击；核心安全仍依赖服务端身份、当前 ACL、严格 Schema、只读 allowlist 和 Worker 系统规则。
- `ActivityEvent` 覆盖从新写路径部署后开始，部署前历史不回填；文档活动已记录，但周报 v1 只消费任务/ECR/ECO 活动。
- 组织/人员负载属于阶段 6；周报 workload 继续省略。
- `npm audit --omit=dev` 仍为 2 critical + 4 high，无可用直接修复路径；生产 Release 门禁不通过。
- 未执行提交、推送、桌面打包或正式发布。

## 8. 验收结论

阶段 5 的本地工程目标已实现并通过门禁，可以进入阶段 6“组织架构与资源负载”。当前结论不是生产签字：生产数据库回填、真实模型、生产性能、依赖漏洞和后续阶段 6–8 仍待完成。
