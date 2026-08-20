# ADR-0002：受控 Action Agent

| 属性 | 内容 |
|---|---|
| 日期 | 2026-08-13 |
| 状态 | **Accepted** |
| 决策者 | 项目负责人 |
| 影响范围 | Agent Tool Gateway、审批治理、任务服务、工作台 UI、审计 |
| 关联文档 | [总体架构 ADR](./ADR-AGENT-ARCHITECTURE.md) · [Action Tool Contract v1](./PLM_ACTION_TOOL_CONTRACT_V1.md) |

## 1. 背景

只读 Agent 已完成 Tool、Runtime、知识、组织与负载闭环。企业用户随后需要让 Agent 辅助完成低风险任务维护，但模型输出、业务授权和真正写入不能合并为一次不可审查的调用。尤其不能依靠提示词保护删除、审批、发布或批量动作。

## 2. 决策

采用严格的“提议与执行分离”协议：

1. 模型只可调用 `sideEffect = proposal` 的 `plm_action_propose_task_update`；该 Tool 只写 `Agent_Approval_Requests`，不改业务表。
2. 提议保存字段级 `before/after`、目标、风险、`expectedVersion`、到期时间、提议散列和执行幂等键。
3. 确认令牌只由登录后的 WorkBuddy 页面签发，不进入模型 Tool 输出、Checkpoint 或提示上下文。
4. UI 同时要求复核勾选和精确短语“确认执行”。执行 API 不注册为 Tool，也不出现在 MCP allowlist。
5. 执行时重新从数据库读取账号状态、项目角色、任务归属与目标版本；提议时权限不作为执行时权限的替代。
6. PostgreSQL Serializable 事务和 advisory lock 串行化同一提议；任务条件更新、审批终态、业务审计、活动事件和回读结果在同一事务完成。
7. 并发重放只有在数据库已存在同一 `EXECUTED` 结果时才返回缓存回读；否则失败关闭。重放仍复核当前读取权限。
8. 首批只允许 `description/priority/dueDate/estimatedHours`。任务状态、负责人、标题、删除、审批、发布、ECO 实施和批量导入不进入执行器。

## 3. 信任边界

| 组件 | 可以做什么 | 明确不能做什么 |
|---|---|---|
| 模型 / Worker | 读取 Tool；创建低风险结构化提议 | 获取确认令牌、调用执行 API、扩大字段或风险范围 |
| Tool Gateway | 校验 schema、身份、提议权限并记录 Tool 审计 | 执行业务更新 |
| 浏览器确认卡 | 向已认证本人展示差异并提交一次性授权 | 自行生成提议字段、替换目标或版本 |
| Action 执行服务 | 重新鉴权、版本 CAS、事务写入、回读 | 执行未注册动作或未列入 allowlist 的字段 |
| PostgreSQL | 唯一键、状态约束、事务与审计一致性 | 判断自然语言意图或替代产品授权策略 |

## 4. 动作风险分级

| 动作 | 风险 | 状态 | 说明 |
|---|---:|---|---|
| 任务低风险字段更新 | LOW | enabled | 必须结构化确认 |
| 保存周报草稿 | LOW | data_not_ready | 草稿/发布边界未完成验收 |
| 删除任务 | HIGH | disabled | 继续使用原业务页 |
| ECR/ECO 审批 | HIGH | disabled | 继续使用原审批页 |
| 产品发布 | HIGH | disabled | 需专项 ADR 与双人复核 |
| ECO 实施 | HIGH | disabled | 不进入首批 Agent |
| 批量导入 | FORBIDDEN | disabled | 模型不得触发 |

## 5. 并发、失败与恢复

- 提议幂等键绑定 `userId + runId + client key + input fingerprint`；同键异内容返回冲突。
- 执行幂等键由服务端生成并设数据库唯一索引。
- 版本变化进入 `CONFLICT`，权限撤销进入 `REJECTED`，到期进入 `EXPIRED`，用户取消进入 `CANCELLED`；这些终态不能复用原授权执行。
- 瞬态事务错误不伪造成功；只有已持久化 `EXECUTED` 结果可作为并发重放依据。
- 搜索索引是派生数据。业务事务成功后索引失败只记录错误，不回滚或重复业务动作。

## 6. 审计与隐私

- Agent 层：`AgentToolExecution + AgentApprovalRequest` 记录提议、版本、状态、结果和失败原因。
- 业务层：`AuditLog` 以审批 ID 为 `correlationId` 记录字段差异；`ActivityEvent` 同 ID 记录事实事件。
- 审计不保存确认令牌、nonce、密码、连接串或完整认证头。
- 执行后回读只返回当前用户仍有权访问的目标字段。

## 7. 未选择方案

- 不让模型直接调用现有任务 PATCH API：无法证明人工确认与模型调用分离。
- 不把确认写进自然语言对话：自由文本不能替代字段差异、版本和一次性授权。
- 不使用“先写后撤销”：撤销无法覆盖通知、审计、索引及外部副作用。
- 不开放通用 JSON Patch：字段范围会随模型输出扩张，难以稳定评测。

## 8. 验收结论

阶段 7 已在隔离 PostgreSQL 14.23、Node 24.12.0 和真实 Chromium 流程验证。未确认、他人、过期、权限撤销、版本冲突和取消均不产生业务写入；并发重复确认只产生一次任务更新和一次业务审计。详见 [阶段 7 验收记录](./agent-acceptance/PHASE_7_CONTROLLED_ACTION_AGENT.md)。
