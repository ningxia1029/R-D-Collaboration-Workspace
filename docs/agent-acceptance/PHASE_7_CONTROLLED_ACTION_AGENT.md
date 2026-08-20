# 阶段 7：受控 Action Agent 验收记录

| 属性 | 结果 |
|---|---|
| 日期 | 2026-08-13 |
| 结论 | **PASS（隔离环境）** |
| 应用环境 | Windows，Node 24.12.0，Next.js 14.2.33 |
| 数据库环境 | WSL Ubuntu 22.04，PostgreSQL 14.23，可丢弃隔离库 |
| 生产状态 | 未发布、未写生产库、未完成阶段 8 生产门禁 |

## 1. 交付范围

- `plm_action_propose_task_update`：模型只创建低风险提议，不写任务。
- 动作注册表：仅任务低风险字段更新 enabled；删除、审批、发布、ECO 实施、批量导入 disabled。
- 审批治理：before/after、expectedVersion、过期、提议散列、执行幂等键、结果与回读。
- 确认 UI：目标、风险、字段差异、勾选、精确确认短语、取消和终态。
- 执行事务：重新鉴权、版本条件更新、Serializable/advisory lock、双审计和回读。

## 2. 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm run typecheck` | PASS |
| 单元/契约/迁移 | `npm test` | **64/64 PASS** |
| 生产构建 | `npm run build` | **45/45 页面生成，PASS** |
| 迁移 | `npx prisma migrate deploy` | **9/9 applied**；复跑无待迁移 |
| 在线索引 | `npm run db:agent-indexes` | **5/5 valid/ready** |
| Schema | `prisma migrate diff ... --exit-code` | `No difference detected` |
| 动作 DB | `npm run db:agent-action-verify` | `AGENT_ACTION_DB_ACCEPTANCE=PASS` |

数据库确定性反例：

- 未提供确认令牌、其他用户确认、过期提议、权限撤销、目标版本变化和用户取消均未改变任务。
- 相同提议幂等键只生成一条审批记录和一条 Tool 审计。
- 两个并发确认只产生一次任务写入、一次 `AuditLog` 和一次 `ActivityEvent`；另一次返回已持久化结果。
- 回读优先级、预估工时和截止日与实际 `Tasks` 行一致，审批 ID 与业务 `correlationId` 一致。

## 3. 浏览器验收

使用专用隔离账号和专用任务，通过 Playwright CLI 驱动真实 Chromium：

- 桌面端完整显示目标、LOW 风险、三项 before/after、expectedVersion 和到期时间。
- 未勾选时禁用；已勾选但输入“错误确认”仍禁用；精确输入“确认执行”才启用。
- 点击后卡片进入 `EXECUTED` 并显示“动作已执行并完成回读”。
- 390×844 下工作台、会话、差异表、确认控件和按钮均可读可操作。
- 桌面与移动端控制台均为 **0 error / 0 warning**。

产物：

- [桌面待确认](../../output/playwright/phase7-action-pending-desktop.png)
- [桌面已执行](../../output/playwright/phase7-action-executed-desktop.png)
- [移动端待确认](../../output/playwright/phase7-action-pending-mobile.png)

浏览器后的数据库独立回查：已执行提议为 `EXECUTED`、任务为 P1/12h/2026-08-28、业务审计 1 条；未确认提议仍为 `PENDING`、任务保持 P2/8h/2026-08-25、业务审计 0 条。

## 4. 验收中发现并关闭的问题

1. 直接服务测试的 ZodError 与 HTTP 400 语义不同：修正验收器按所在层断言，未涉及业务写入。
2. 两个 Serializable 确认事务并发时后者可能收到 PostgreSQL P2034：仅在数据库已存在同一 `EXECUTED` 结果时转换为幂等回放，否则继续失败关闭。

每次修正后均销毁失败实例并在全新隔离库重跑；最终证据来自第三个及后续全新实例。

## 5. 不能证明的范围

- 未在 PostgreSQL 16、真实生产数据库或真实企业组织/权限数据上验收。
- 未完成真实模型供应商、企业 IdP、TLS/WAF、多节点高并发和灾备演练。
- 未开放周报草稿保存；任务状态、指派、删除、审批、发布、ECO 实施和批量导入仍禁用。
- 阶段 8 的 50+ 评测集、性能/成本 SLO、依赖漏洞、恢复、桌面签名与升级回滚尚未关闭。
