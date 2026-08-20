# PLM 企业研发智能体分阶段实施与验收计划

| 属性 | 内容 |
|---|---|
| 文档状态 | 执行中 |
| 版本 | 1.3 |
| 日期 | 2026-08-13 |
| 上级任务 | PLM 企业研发智能体 |
| 产品基线 | WorkBuddy Pro 1.0.1，分支 `codex/workbuddy-production-hardening` |
| 关联文档 | [产品需求](./AGENT_PRODUCT_REQUIREMENTS.md) · [架构 ADR](./ADR-AGENT-ARCHITECTURE.md) · [Tool Contract v1](./PLM_TOOL_CONTRACT_V1.md) |

## 1. 执行原则

- 严格按阶段依赖推进；阶段代码完成不等于阶段验收通过。
- 每个阶段必须留下自动化命令、关键输出、可证明范围和不可证明范围。
- 数据库变更先生成迁移与回滚说明，只在隔离 PostgreSQL 中演练，不运行 `db push/setup/seed` 写入现有业务库。
- 当前工作树已有大量生产加固改动；新增 Agent 工作保持目录和 diff 可识别，不覆盖无关文件。
- 每个阶段完成 Codex 自测后在 Notion 记录为“验证/待评审”；只有满足该阶段全部门禁才标记阶段任务“已完成”。
- 权限、事实正确性、提示注入和恢复场景从第一阶段开始积累为版本化评测集。

## 2. 总体阶段

| 阶段 | 名称 | 核心交付 | 当前状态 |
|---:|---|---|---|
| 0 | 规格冻结与工程基线 | PRD/ADR/Tool 契约定稿、阶段计划、Notion 任务树、基线证据 | **已完成** |
| 1 | Agent-ready 数据与治理模型 | 组织、Agent 审计、活动事件、Outbox/检查点模型和安全迁移 | **已完成** |
| 2 | 只读 PLM Tool Core | 单一 Schema 注册表、8 个 MVP Tool、统一错误/证据/权限/分页 | **已完成** |
| 3 | Agent Runtime 与 Harness | 独立 TS Worker、LangGraph 状态图、Provider Adapter、Run 恢复/取消 | **已完成** |
| 4 | 工作台 UI 与会话体验 | Agent 页面、SSE、项目上下文、消歧、证据跳转、管理开关 | **已完成** |
| 5 | 权限感知知识检索与周报 | 文档版本片段、注入防护、活动数据包、周报草稿 | **已完成** |
| 6 | 组织架构与资源负载 | 主部门/岗位/经理、组织授权、产能与时间窗负载 | **已完成** |
| 7 | 受控 Action Agent | 提议、确认、版本重验、幂等执行、回读与双审计 | **已完成** |
| 8 | 评测治理与生产验收 | 回归/红队/性能/成本、RBAC/E2E、恢复、发布与运行手册 | **进行中** |

阶段 0–6 构成企业只读智能体完整闭环；阶段 7 单独引入写操作；阶段 8 是生产交付门禁。单 Agent 未被评测证明成为瓶颈前，不增加多 Agent 阶段。

## 3. 阶段 0：规格冻结与工程基线

### 目标

把需求、架构、Tool 契约、阶段边界和验收方式固化为唯一实施基线，并建立可追踪的 Notion 任务树。

### 任务

- [x] PRD、ADR、Tool Contract 经项目负责人确认并转为正式状态。
- [x] 固化默认决策：只读首发、主部门模型、公共文档当前语义、进度/齐套率 v1 口径。
- [x] 建立 9 阶段实施计划和阶段依赖。
- [x] 在既有 `ALG-23` 下创建 Agent 主任务、阶段任务和实施计划页。
- [x] 记录当前 Git/Node/依赖/测试/生产门禁基线，不把历史结果当成本轮新验证。

### 验收命令

```powershell
git status --short --branch
npm run test
npm run typecheck -- --incremental false
npx prisma validate
npm run build
npm audit --omit=dev
```

### 通过标准

- 三份基线文档状态一致，本地链接、UTF-8、代码围栏和关键术语检查通过。
- Notion 复用既有 WorkBuddy 主任务，不创建重复主任务；阶段任务不少于 6 个。
- 记录上述命令的真实结果；任何失败项进入风险清单，不用历史日志覆盖。
- 阶段 0 不执行数据库迁移、seed、发布、提交或推送。

验收证据：[阶段 0 验收记录](./agent-acceptance/PHASE_0_BASELINE.md)。阶段 0 的通过只表示工程实施基线成立；依赖漏洞、Node 版本偏差和生产验收仍作为后续门禁保留。

## 4. 阶段 1：Agent-ready 数据与治理模型

### 目标

补齐后续 Tool、Run、组织和周报所需的数据基础，同时保持向后兼容与可回滚。

### 任务

- [x] 新增 `OrgUnit`、`Position`，扩展用户主部门、岗位、经理和周标准产能。
- [x] 新增 `AgentRun`、`AgentMessage`、`AgentToolExecution`、`AgentFeedback`、`AgentApprovalRequest`。
- [x] 新增结构化 `ActivityEvent` 与事务 `OutboxEvent`；Agent 审计和业务审计分层。
- [x] 设计 Run/Tool 状态、保留期、correlation/idempotency/version 字段与索引。
- [x] 生成正式 Prisma migration、在线索引工具、回滚说明与数据回填策略；未操作现有业务数据库。
- [x] 增加 schema、迁移 SQL、关系约束与敏感字段测试。

### 验收

- `npx prisma format`、`npx prisma validate`、`npm run typecheck`、相关测试、`npm run build` 通过。
- 隔离 PostgreSQL 完成 migrate deploy、回滚/前滚与旧数据兼容演练；未连接生产业务库。
- 组织循环、自我经理、负产能、非法 Run 状态、重复幂等键被确定性拒绝。
- 敏感字段和 Agent 审计保留策略有明确边界；Notion 记录迁移证据与未验证项。

验收证据：[阶段 1 验收记录](./agent-acceptance/PHASE_1_AGENT_GOVERNANCE.md)。阶段 1 已在可丢弃的 PostgreSQL 14.23 隔离实例完成全量前滚、失败恢复、约束负例、在线索引幂等和 drift 检查；这不等同于生产规模或 PostgreSQL 16 的性能验收。

## 5. 阶段 2：只读 PLM Tool Core

### 目标

实现 Tool Contract v1 的统一注册、执行、权限、错误、证据和分页基础，并交付 8 个只读 MVP Tool。

### 任务

- [x] 建立 Zod 单一 Schema 源、Tool registry、execution context 和响应 envelope。
- [x] 实现项目解析/摘要、任务列表/依赖、里程碑、BOM 风险、变更影响、文档关键词检索。
- [x] 复用 Prisma 只读数据源与既有 RBAC 语义，不把 `userId/role/visibleProjectIds` 暴露为模型参数。
- [x] 增加 HMAC 稳定 cursor、结果上限、超时、审计和禁用开关。
- [x] 提供内部 Adapter；MCP Adapter 只映射同一 registry，不复制业务逻辑。

### 验收

- Tool 输入输出均通过 JSON Schema；未知字段、越限和非法枚举被拒绝。
- admin/pm/engineer/viewer × 成员/非成员覆盖核心 Tool；跨项目实体不可枚举。
- 固定夹具中进度、健康度、逾期和齐套率与直接业务查询完全一致。
- 所有结果包含 `asOf/scope/warnings/evidence`；v1 Tool 运行前后业务表无变化。
- 内部 Adapter 与 MCP Adapter 对同一上下文得到等价结构化结果。

验收证据：[阶段 2 验收记录](./agent-acceptance/PHASE_2_READ_ONLY_TOOL_CORE.md)。阶段 2 已在固定夹具和可丢弃 PostgreSQL 实例验证 8 个只读 Tool、四角色项目范围、动态权限撤销、稳定分页、确定性口径、双 Adapter 等价、Agent 审计与业务表无副作用；Run 取消/恢复属于阶段 3。

## 6. 阶段 3：Agent Runtime 与 Harness

### 目标

实现独立、有限、可恢复的单 Agent 运行时，不让模型或 Worker 直连业务数据库。

### 任务

- [x] 创建独立 TypeScript Worker 包和进程入口；精确锁定 LangGraph/Core，并将生产基线校准到仍受支持的 Node 22/24。
- [x] 使用 LangGraph.js 实现意图/消歧/Tool/回答状态图、检查点与人工等待状态。
- [x] 实现 Provider Adapter、Prompt 版本、模型能力探测和结构化 Tool 调用。
- [x] 实现 Run 租约、心跳、取消、超时、最大步数/Tool 次数/token/结果字节数。
- [x] 实现短期委托上下文与 Gateway 验证；Worker 不持有数据库连接串。

### 验收

- 静态规则与运行测试证明 Worker 不导入 Prisma、不读取 `DATABASE_URL`。
- Worker 中断后从最后检查点恢复，不重复 Tool 审计；取消与超时进入确定终态。
- 模型不可用、Tool 超时、限流和非法 Tool 名都有安全恢复和停止条件。
- Provider 假实现/至少一个真实 Provider 冒烟通过；真实调用只在配置凭据后执行并记录成本边界。

验收证据：[阶段 3 验收记录](./agent-acceptance/PHASE_3_AGENT_RUNTIME.md)。阶段 3 已通过 Node 22.22.2/24.12.0 双版本测试和可丢弃 PostgreSQL 14.23 故障恢复演练；真实供应商凭据未配置，因此只验证了 OpenAI-compatible 真实协议适配形状和 deterministic fake，没有对外发送模型请求。

## 7. 阶段 4：工作台 UI 与会话体验

### 目标

把 Agent 作为 WorkBuddy 业务入口嵌入 Web/桌面工作台，提供可解释、可取消的会话体验。

### 任务

- [x] 新增 Agent 页面、导航入口、项目上下文入口和仅本人会话列表。
- [x] 实现创建 Run、SSE 事件、取消、同 Run 恢复、错误与安全重试 UI。
- [x] 实现项目消歧、证据列表、`asOf`、权限裁剪、警告和限制展示。
- [x] 实现 WorkBuddy 实体深链；无权限统一隐藏存在性，权限撤销后历史结果 fail closed。
- [x] 新增管理员总开关、Tool 状态、Worker 心跳/失败摘要和控制动作审计页面。

### 验收

- Playwright 覆盖登录、问答、消歧、取消、失败、证据跳转和跨项目拒绝。
- 页面刷新/桌面壳重启后能恢复 Run 状态，不出现重复消息。
- 键盘操作、焦点、屏幕阅读标签、窄屏和真实滚动通过基础可访问性检查。
- 未配置 Agent 服务时主 PLM 正常工作，并显示可诊断的降级状态。

验收证据：[阶段 4 验收记录](./agent-acceptance/PHASE_4_AGENT_WORKBENCH.md)。阶段 4 已在隔离 PostgreSQL 和真实 Chromium 页面完成管理员/工程师双角色、SSE、消歧恢复、证据跳转、取消/重试、总开关、390×844 窄屏与干净控制台验收；外部真实模型、企业 IdP 和人工屏幕阅读器仍不在本阶段证明范围。

## 8. 阶段 5：权限感知知识检索与周报

### 目标

交付带版本片段引用的工程知识问答，以及由结构化活动数据驱动的周报草稿。

### 任务

- [x] 为文档建立版本/分块/sectionPath/indexVersion 和 ACL 索引记录。
- [x] 形成关键词检索基线；固定知识集 Recall@5=1.00、引用支持率=1.00，现阶段不引入向量检索。
- [x] Outbox 驱动增量索引；读取按当前文档归属/成员关系二次鉴权，撤权立即生效。
- [x] 实现文档提示注入隔离、片段长度限制、引用支持检查和可见范围内的索引延迟告警。
- [x] 实现活动事件周报数据包与模板草稿；完成项/变更不从当前快照猜历史。

### 验收

- 固定知识集的召回、引用版本和引用支持率达到评审阈值；阈值在样本建立后写入。
- 项目权限撤销后旧索引结果不可返回；公共文档策略有正反测试。
- 注入攻击集无法改变 Tool allowlist、身份或系统规则。
- 周报完成项与活动事件逐条一致，缺失数据进入 `omittedSections/warnings`。

验收证据：[阶段 5 验收记录](./agent-acceptance/PHASE_5_KNOWLEDGE_AND_WEEKLY_REPORT.md)。阶段 5 已在全新隔离 PostgreSQL 14.23 上完成 7/7 migration、5/5 在线索引、零实际 schema 漂移、事务 Outbox、版本替换、ACL/撤权、隐藏积压、注入样本与 ActivityEvent 周报验收；固定 10 条关键词知识集 Recall@5 和引用支持率均为 1.00。语义召回、生产规模、PostgreSQL 16、真实模型和不少于 50 条的完整评测仍不在本阶段证明范围。

## 9. 阶段 6：组织架构与资源负载

### 目标

在组织和产能数据就绪后，安全开放组织查询与可解释负载分析。

### 任务

- [x] 实现组织树、岗位、经理、成员维护和组织范围授权。
- [x] 启用 `plm_org_get_tree`、`plm_org_list_members`。
- [x] 实现时间窗产能、计划工时、登记工时和数据质量计算。
- [x] 启用 `plm_member_get_workload`，区分开放预估工时、计划工时和利用率。
- [x] 增加组织循环、离职、跨组织/项目和个人隐私测试。

### 验收

- 组织树无环、主部门唯一、经理关系有效；非法关系无法写入。
- `time:read` 仅本人，`time:read_all` 仍需项目/组织范围；邮箱不进入模型上下文。
- 缺少产能/计划时 `utilizationPercent = null`，Agent 不把开放任务量表述为利用率。
- 固定时间窗的负载结果与直接聚合完全一致，时区和工作日边界有测试。

验收证据：[阶段 6 验收记录](./agent-acceptance/PHASE_6_ORGANIZATION_AND_WORKLOAD.md)。阶段 6 已在全新隔离 PostgreSQL 14.23 上完成 8/8 migration、5/5 在线索引、零 schema 漂移、9/9 Tool 审计与只读快照验收；固定窗口聚合为 5 工作日、40h 产能、30h 计划、6h 登记和 75% 利用率，缺失与明确零计划可区分。桌面与 390×844 移动端均通过真实浏览器回查。企业节假日、真实组织数据、PostgreSQL 16 和规模性能仍不在本阶段证明范围。

## 10. 阶段 7：受控 Action Agent

### 目标

只开放经批准的低风险写动作，并证明未经确认的写入不可能发生。

### 任务

- [x] 另立 Action Agent ADR 与写 Tool Contract，完成动作风险分级。
- [x] 实现 proposal、before/after、expectedVersion、approval、过期和一次性执行授权。
- [x] 执行前重新鉴权/读版本；事务内幂等执行和双层审计；执行后回读。
- [x] 首批仅支持低风险任务字段更新；删除、审批、发布、ECO 实施和批量导入保持禁用。
- [x] 实现结构化确认 UI、并发冲突、取消和失败恢复。

### 验收

- 无确认、过期确认、他人确认、版本变化和权限变化均无法执行。
- 同一幂等键重复请求只产生一次业务结果；失败可安全重试。
- 回读证据与实际写入一致，Agent/业务审计可串联。
- 高风险动作注册表为空或明确 disabled；红队提示不能绕过确认页。

验收证据：[阶段 7 验收记录](./agent-acceptance/PHASE_7_CONTROLLED_ACTION_AGENT.md)。阶段 7 已在全新隔离 PostgreSQL 14.23 上完成 9/9 migration、5/5 在线索引和零 schema 漂移；全量单测 64/64、构建 45/45。无确认、他人、过期、权限撤销、版本变化和取消均无业务写入；并发重复确认只有一次任务更新与业务审计。桌面和 390×844 真实浏览器确认门禁、执行终态及 0 error/0 warning 已回查。

## 11. 阶段 8：评测治理与生产验收

### 目标

把准确率、安全、性能、成本、恢复和现有 WorkBuddy 生产门禁统一成可签署的交付证据。

### 任务

- [x] 建立 68 条版本化确定性业务评测，覆盖 schema、权限矩阵、提示注入和治理门禁。
- [x] 建立 CI judge：schema、unit、integration、Playwright、migration、build、audit、恢复和产物校验；远端工作流仍待实际运行。
- [x] 以自有 Agent/Tool/业务审计为生产基线，验证脱敏、保留清理双确认、查询和停用开关；可选 Langfuse 未启用。
- [ ] 已完成本机 Adapter 微基准、有界超时/限流、检查点恢复、Action 并发幂等与数据库恢复；真实模型/网络/数据库端到端 P95 SLO 仍待预生产校准。
- [ ] 关闭现有依赖漏洞、隔离数据库恢复、RBAC/E2E、HTTPS、桌面签名/升级回滚门禁。
- [x] 生成部署、回滚、事故响应、模型切换、数据删除和生产验收手册。

### 验收

- 固定评测集达到批准阈值，权限泄露与未确认写入为 0；主要结论证据覆盖率 100%。
- 所有自动门禁和人工验收均有日期、环境、命令/步骤、输出摘要和责任人。
- 生产数据库恢复、模型/Worker 故障降级、桌面升级回滚完成演练。
- 只有全部交付门禁通过并经项目负责人确认，主任务才标记完成并允许正式 Release。

当前证据：[阶段 8 验收记录](./agent-acceptance/PHASE_8_EVALUATION_AND_PRODUCTION.md) 与 [生产验收矩阵](./agent-operations/PRODUCTION_ACCEPTANCE.md)。截至 2026-08-13，本地工程门禁通过，但阶段 8 保持进行中 / NO-GO：PostgreSQL 16 远端工作流、真实模型、企业 IdP、真实 HTTPS/TLS、SIEM、代表性端到端 SLO、正式代码签名和双版本升级回滚均缺少真实环境证据。

2026-08-20 补充：DeepSeek V4 Flash 非思考模式已完成 30 条 × 3 次脱敏 live eval，87/90（96.7%），权限泄露、敏感数据泄露和未确认写入均为 0，P95 3.69s，模型/网络成本约 $0.005971。该证据关闭“没有任何真实模型调用”的缺口，但不关闭 PostgreSQL/Web/SSE 全链路、思考模式、企业数据驻留审批或生产 SLO 门禁。

## 12. 评测资产规范

每个阶段新增或更新 `tests/agent/fixtures` 下的版本化任务。每条任务至少包含：

- 固定数据夹具/前置身份与权限；
- 用户问题或结构化 Tool 输入；
- 至少一个确定性 judge；
- 允许/禁止的证据、Tool 和副作用；
- 期望错误码或终态；
- 适用的 schema/prompt/model/tool 版本。

模型评委只能作为补充，不能替代权限、数字、状态和数据库副作用的确定性断言。

## 13. Notion 同步规则

- 复用既有 WorkBuddy 主任务 `ALG-23`，新增一个“PLM 企业研发智能体”子任务作为本计划上级。
- 阶段 0–8 分别创建子任务；阶段未开始为 0%，开始后只记录可证实进度。
- 每个阶段关闭时新增“验证”工作记录，包含命令、通过数、产物、不能证明的范围和下一阶段。
- 阻断立即更新任务状态/风险；Codex 自测通过但待用户验收时保持“进行中”或“待评审”语义，不提前标记交付。
- 最终用户确认和全部门禁通过后，才把 Agent 主任务与 `ALG-23` 的相关范围标记完成。

## 14. 当前已知风险

- WorkBuddy 当前工作树大量未提交，阶段性验证结果不能直接作为干净 HEAD 的发布证据。
- 本地依赖漏洞已清零，PostgreSQL 14.23 隔离恢复和未登录浏览器门禁已通过；PostgreSQL 16 远端运行、企业 IdP、真实模型、HTTPS/TLS、SIEM、完整业务 RBAC/E2E 和桌面正式签名/双版本回滚仍待验收。
- Node 20 已于 2026-04-30 EOL；阶段 3 已锁定 LangGraph 1.4.9 / Core 1.2.5，并把生产基线改为 Node 22–26（已实测 Node 22.22.2 与 24.12.0）。
- 组织与产能当前无真实业务数据；阶段 6 的算法验收需要代表性脱敏夹具或用户提供的数据规则。
- 模型部署、数据驻留、敏感字段和保留期限必须在真实企业策略下最终确认。
