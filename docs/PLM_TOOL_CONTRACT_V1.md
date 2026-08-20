# PLM Tool Contract v1

| 属性 | 内容 |
|---|---|
| 文档状态 | 已定稿（Approved） |
| 契约版本 | 1.0 |
| 日期 | 2026-08-12 |
| 最近实现状态更新 | 2026-08-13（阶段 5） |
| 适用范围 | PLM 企业研发智能体首期只读 Tool |
| 关联文档 | [产品需求](./AGENT_PRODUCT_REQUIREMENTS.md) · [架构 ADR](./ADR-AGENT-ARCHITECTURE.md) |

> 本文档已于 2026-08-12 确认为实现基线。阶段 5 已实现权限感知文档片段检索和活动事件周报；组织/负载 Tool 仍在数据与权限前置条件完成前保持禁用。实际阶段状态与证据见 [实施计划](./AGENT_IMPLEMENTATION_PLAN.md)。

## 1. 设计原则

1. **Tool 是受控应用服务，不是数据库查询语言**：不接受 SQL、Prisma `where`、任意字段表达式、任意 URL 或内部函数名。
2. **身份不是模型参数**：`userId`、角色、权限和可见项目由 Tool Gateway 在服务端注入并逐次校验。
3. **只读首发**：v1 注册给模型的 Tool 全部 `sideEffect = none`，不得改变任何业务实体。
4. **确定性与可解释**：聚合算法、状态筛选、时区和 `asOf` 明确；数字来自 Tool 字段，不从自然语言片段估算。
5. **证据是契约的一部分**：成功结果必须包含足以支持业务结论的实体、聚合或文档片段证据。
6. **权限优先于召回**：先限定项目/组织/文档范围，再查询；返回前再次校验和裁剪。
7. **严格 Schema**：所有 object 默认 `additionalProperties: false`；未知字段、非法枚举和超限参数直接拒绝。
8. **有界执行**：列表有默认/最大 limit、稳定排序和 cursor；时间范围与检索文本长度受限。
9. **单一 Schema 源**：实施时以 Zod 为唯一源，生成 TypeScript 类型、JSON Schema、内部适配和 MCP Tool 描述。
10. **失败显式化**：无数据、歧义、权限不足、数据质量不足和依赖失败均返回稳定错误/警告，不转换成猜测。

## 2. 命名、版本与传输

### 2.1 Tool 名称

- 暴露名称使用小写 snake_case，满足常见模型 Provider 的函数名约束，例如 `plm_project_get_summary`。
- `plm_` 是产品前缀；第二段是领域；其余部分是动作。
- 文档中的逻辑操作名可写作 `project.get_summary`，但线上注册名以 snake_case 为准。
- Tool 名称一经发布不得改变语义；破坏性变更发布新主版本或新 Tool 名。

### 2.2 契约版本

- 响应字段 `contractVersion` 固定为 `1.0`。
- 增加可选输入、增加响应字段或增加 Tool 属于向后兼容变更。
- 删除/重命名字段、改变枚举含义、改变算法语义或收紧既有成功输入属于破坏性变更。
- 每个聚合算法另带 `calculationMethod` 或 `ruleSetVersion`，算法改变不允许静默发生。

### 2.3 传输映射

契约与传输无关：

- Agent Worker 通过内部 Tool Gateway 调用同一注册表；
- MCP Adapter 将同一 `name/description/inputSchema/outputSchema` 映射为 MCP Tool；
- 若提供内部 HTTP，建议创建 `tool-execution` 资源并由网关路由，不为每种客户端复制业务实现；
- MCP 的 `structuredContent` 和内部调用结果必须符合本文公共 envelope。

## 3. 受信执行上下文

以下上下文由 WorkBuddy/Tool Gateway 注入，不属于模型可见的 Tool input：

```ts
type ToolExecutionContext = {
  runId: string;
  traceId: string;
  requestId: string;
  sessionSubject: string;       // 服务器可验证的会话主体，不是任意 userId
  issuedAt: ISODateTime;
  expiresAt: ISODateTime;
  locale: "zh-CN" | string;
  timezone: string;             // IANA 时区，例如 Asia/Shanghai
};
```

执行要求：

- `expiresAt` 过期立即返回 `auth_expired`。
- Gateway 根据 `sessionSubject` 重新读取用户状态和角色，复用 `requireAuth/effectiveRole/requireProjectAccess` 的语义。
- admin 也只获得当前 Tool 声明的字段；管理员身份不自动允许把全部敏感字段发送给模型。
- Tool input 中若出现 `userId/role/projectIds/permissionCodes/sql/where` 等控制字段，严格 Schema 会将其拒绝。
- 服务间凭据、会话令牌和数据库连接信息不得进入模型上下文、Tool 响应或 Agent 审计正文。

## 4. 公共类型

```ts
type ISODateTime = string; // ISO 8601，必须带 Z 或明确偏移
type DateOnly = string;    // YYYY-MM-DD，按执行上下文 timezone 解释
type EntityId = string;    // 不透明 ID，调用方不得解析其格式
type Cursor = string;      // 不透明、带签名或服务端可验证
type ToolName =
  | "plm_project_resolve"
  | "plm_project_get_summary"
  | "plm_task_list"
  | "plm_task_get_dependencies"
  | "plm_milestone_list"
  | "plm_bom_get_risks"
  | "plm_change_get_impact"
  | "plm_document_search"
  | "plm_org_get_tree"
  | "plm_org_list_members"
  | "plm_member_get_workload"
  | "plm_report_generate_weekly";

type ToolWarning = {
  code: string;
  message: string;
  field?: string;
};

type EvidenceRef = {
  evidenceId: string;      // 本次 Tool 结果内唯一，供最终答案引用
  kind: "entity" | "aggregate" | "document_chunk";
  entityType:
    | "PROJECT" | "PHASE" | "TASK" | "MILESTONE"
    | "BOM_ITEM" | "TECH_SPEC" | "ECR" | "ECO"
    | "DOCUMENT" | "ORG_UNIT" | "USER";
  entityId?: EntityId;
  projectId?: EntityId | null;
  label: string;
  uri?: string;            // WorkBuddy 内部相对路径，不返回任意外部 URL
  version: {
    type: "updated_at" | "doc_version" | "snapshot";
    value: string;
  };
  excerpt?: string;        // 文档证据最多 500 个 Unicode 字符
};

type AppliedScope = {
  projectIds: EntityId[];          // 本次结果实际涉及的项目，不是用户全部权限清单
  orgUnitIds?: EntityId[];
  permissionsApplied: string[];
  redactions: string[];
};

type PageInfo = {
  limit: number;
  hasMore: boolean;
  nextCursor: Cursor | null;
};

type ToolSuccess<T> = {
  ok: true;
  contractVersion: "1.0";
  tool: ToolName;
  requestId: string;
  traceId: string;
  data: T;
  evidence: EvidenceRef[];
  asOf: ISODateTime;
  scope: AppliedScope;
  warnings: ToolWarning[];
  page?: PageInfo;
};

type ToolFailure = {
  ok: false;
  contractVersion: "1.0";
  tool: ToolName;
  requestId: string;
  traceId: string;
  error: {
    code: ToolErrorCode;
    message: string;       // 可展示、无堆栈/SQL/内部路径
    retryable: boolean;
    details?: Array<{ field?: string; code: string; message: string }>;
  };
  asOf: ISODateTime;
};
```

### 4.1 通用约束

- 字段命名统一 camelCase；枚举值统一小写 snake_case，已有业务状态原值除外。
- `limit` 默认 20、最大 100；候选消歧最大 10。
- 普通 `query` 长度 1–100；文档检索 `query` 长度 2–500。
- 任何时间范围默认最大 92 天；更长范围必须拆分或使用专用聚合。
- 列表排序必须包含唯一 ID 作为最终 tie-breaker，保证 cursor 稳定。
- `asOf` 是该结果完成业务读取的服务器时间，不是模型生成时间。
- `warnings` 为空时返回 `[]`，不得省略。
- 无匹配列表是成功空结果；目标实体不可访问、输入歧义或前置能力未启用才是失败。

## 5. 错误契约

```ts
type ToolErrorCode =
  | "validation_error"
  | "auth_required"
  | "auth_expired"
  | "resource_not_accessible"
  | "ambiguous_reference"
  | "conflict"
  | "tool_disabled"
  | "data_not_ready"
  | "rate_limited"
  | "timeout"
  | "dependency_unavailable"
  | "internal_error";
```

| 错误码 | retryable | 行为 |
|---|---:|---|
| `validation_error` | false | 返回字段级错误，不进入模型重试循环 |
| `auth_required/auth_expired` | false | 提示用户重新登录，不自动换用服务账号 |
| `resource_not_accessible` | false | 统一覆盖“不存在或无权限”，防止枚举实体 |
| `ambiguous_reference` | false | 由解析 Tool 返回有权限候选，要求用户选择 |
| `conflict` | false | 数据版本/状态冲突；只读 v1 通常不出现 |
| `tool_disabled/data_not_ready` | false | 明确指出前置能力，Agent 不使用其他数据猜测 |
| `rate_limited/timeout/dependency_unavailable` | true | 按网关策略有限重试，遵守 `retryAfterMs`（若提供） |
| `internal_error` | false | 记录内部 trace；对模型只返回通用提示 |

内部 HTTP 映射建议使用 400/401/404/409/422/429/503/500；Agent/MCP 客户端必须以结构化 `error.code` 为稳定判断依据。

## 6. Tool 注册表

| 暴露名称 | 逻辑操作 | 权限 | 当前数据基础 | v1 状态 |
|---|---|---|---|---|
| `plm_project_resolve` | `project.resolve` | `project:read` | 项目表与可见项目范围可用 | MVP 启用 |
| `plm_project_get_summary` | `project.get_summary` | `project:read` + `dashboard:read` | 现有 Dashboard 可复用；需补统一契约与证据 | MVP 启用 |
| `plm_task_list` | `task.list` | `task:read` | 任务筛选可用；需补 cursor 和统一逾期语义 | MVP 启用 |
| `plm_task_get_dependencies` | `task.get_dependencies` | `task:read` | 直接依赖可用；深度/冲突摘要需扩展 | MVP 启用 |
| `plm_milestone_list` | `milestone.list` | `project:read` | 模型存在；需新增只读 service | MVP 启用 |
| `plm_bom_get_risks` | `bom.get_risks` | `bom:read` | BOM 状态、ETA、关键标记、齐套率可用 | MVP 启用 |
| `plm_change_get_impact` | `change.get_impact` | `ecr:read` 或 `eco:read` | ECR/ECO 与 ECO 影响项可用；需解析实体标签 | MVP 启用 |
| `plm_document_search` | `document.search` | `kb:read` | 最新版 Markdown 片段、版本证据、当前 ACL 二次过滤与 Outbox 增量索引 | **阶段 5 已启用（仅 lexical）** |
| `plm_org_get_tree` | `org.get_tree` | `org:read` | 主部门组织树、负责人子树范围、成员字段白名单 | **阶段 6 已启用** |
| `plm_org_list_members` | `org.list_members` | `org:read` | 组织/项目交集、分页、成员隐私字段脱敏 | **阶段 6 已启用** |
| `plm_member_get_workload` | `member.get_workload` | `time:read` / `time:read_all` | 发布计划窗口、周产能、时区工时和数据质量 | **阶段 6 已启用** |
| `plm_report_generate_weekly` | `report.generate_weekly` | `project:read` + `dashboard:read` + `task:read` + `bom:read` + `ecr:read` + `eco:read` | `ActivityEvent` 完成/变更事实流 + 当前风险/进度快照 | **阶段 5 已启用；workload 仍省略** |

“阶段 5/6 已启用”仅表示实现和本地工程门禁通过；不等同于生产部署、真实模型或正式 Release 已验收。

## 7. Tool 详细契约

### 7.1 `plm_project_resolve`

用途：把用户输入的项目编码或名称解析为有权限的项目 ID；任何模糊项目引用先调用本 Tool。

```ts
type ProjectResolveInput = {
  query: string;                 // 1..100
  contextProjectId?: EntityId;  // UI 已明确携带时优先，但仍鉴权
  limit?: number;                // 1..10，默认 5
};

type ProjectResolveData = {
  resolution: "exact" | "single_candidate" | "ambiguous" | "not_found";
  candidates: Array<{
    id: EntityId;
    code: string;
    name: string;
    status: "active" | "completed" | "archived";
    lifecycleStage: string;
    matchedBy: "context" | "code" | "exact_name" | "partial_name";
  }>;
};
```

规则：编码精确匹配优先于名称；`ambiguous` 不自动选择；候选必须先经过 `visibleProjectIds`/项目成员过滤。

### 7.2 `plm_project_get_summary`

用途：返回一个项目的可解释进度、健康度和核心计数，替代模型跨多个列表自行计算。

```ts
type ProjectGetSummaryInput = {
  projectId: EntityId;
  include?: Array<"progress" | "health" | "counts" | "upcoming_milestones">;
};

type ProjectGetSummaryData = {
  project: {
    id: EntityId;
    code: string;
    name: string;
    status: string;
    lifecycleStage: string;
    owner: { id: EntityId; name: string } | null;
    startDate: ISODateTime | null;
    endDate: ISODateTime | null;
  };
  progress?: {
    percent: number;             // 0..100
    completedTasks: number;
    totalTasks: number;
    calculationMethod: "done_task_count";
    formula: "round(completedTasks / totalTasks * 100)";
    emptyProjectValue: 0;
  };
  health?: {
    level: "green" | "yellow" | "red";
    ruleSetVersion: "project_health_v1";
    blockedTaskCount: number;
    overdueTaskCount: number;
    delayedBomCount: number;
    reasonCodes: Array<"blocked_tasks" | "overdue_tasks" | "delayed_bom">;
  };
  counts?: {
    openTasks: number;
    milestonesPending: number;
    submittedEcr: number;
    pendingEco: number;
  };
  upcomingMilestones?: Array<{
    id: EntityId;
    name: string;
    date: ISODateTime;
    status: string;
  }>;
};
```

规范算法：

- `progress` 与当前系统一致，仅表示任务数完成率，不表示工时、成本或阶段加权进度。
- `project_health_v1`：存在阻塞任务或逾期未完成任务时为 red；否则存在 `Delayed` BOM 时为 yellow；其余为 green。
- `submittedEcr` 只统计状态为 `SUBMITTED` 的 ECR；`pendingEco` 只统计状态为 `PENDING` 的 ECO。
- Tool 必须返回限制警告，例如 `progress_is_task_count_based`；后续权重算法使用新的 `calculationMethod`，不得覆盖 v1 含义。

### 7.3 `plm_task_list`

用途：按受控条件查询任务；逾期、阻塞和即将到期均由本 Tool 的确定性筛选完成。

```ts
type TaskListInput = {
  projectId: EntityId;
  statuses?: Array<"To Do" | "In Progress" | "Blocked" | "Testing" | "Done">;
  priorities?: Array<"P0" | "P1" | "P2" | "P3">;
  phaseId?: EntityId;
  assigneeId?: EntityId;
  query?: string;                // 1..100，仅标题/受控字段
  overdueOnly?: boolean;
  dueFrom?: DateOnly;
  dueTo?: DateOnly;
  updatedSince?: ISODateTime;
  sort?: "due_date_asc" | "priority_asc" | "updated_at_desc";
  cursor?: Cursor;
  limit?: number;                // 1..100，默认 20
};

type TaskListData = {
  items: Array<{
    id: EntityId;
    projectId: EntityId;
    title: string;
    status: "To Do" | "In Progress" | "Blocked" | "Testing" | "Done";
    priority: "P0" | "P1" | "P2" | "P3";
    assignee: { id: EntityId; name: string } | null;
    phase: { id: EntityId; name: string } | null;
    startDate: ISODateTime | null;
    dueDate: ISODateTime | null;
    estimatedHours: number | null;
    isOverdue: boolean;
    updatedAt: ISODateTime;
  }>;
};
```

`overdueOnly = true` 的固定语义是 `status != Done AND dueDate < asOf`。日期边界按执行上下文时区转换后查询。默认不返回完整任务描述，避免无必要地扩大模型上下文。

### 7.4 `plm_task_get_dependencies`

用途：读取任务依赖图及可确定的日期冲突。

```ts
type TaskGetDependenciesInput = {
  taskId: EntityId;
  direction?: "predecessors" | "successors" | "both"; // 默认 both
  depth?: 1 | 2 | 3;                                   // 默认 1
};

type TaskGetDependenciesData = {
  rootTaskId: EntityId;
  nodes: Array<{
    id: EntityId;
    title: string;
    status: string;
    startDate: ISODateTime | null;
    dueDate: ISODateTime | null;
  }>;
  edges: Array<{
    id: EntityId;
    predecessorId: EntityId;
    successorId: EntityId;
    type: "FS" | "SS" | "FF" | "SF" | string;
    lagDays: number;
    dateConflict: boolean;
  }>;
};
```

所有节点必须属于根任务同一项目；超过深度或结果上限时截断并返回 warning。`dateConflict` 只表示当前可计算的日期矛盾，不等于完整关键路径分析。

### 7.5 `plm_milestone_list`

```ts
type MilestoneListInput = {
  projectId: EntityId;
  statuses?: Array<"pending" | "done" | "missed">;
  dateFrom?: DateOnly;
  dateTo?: DateOnly;
  cursor?: Cursor;
  limit?: number;
};

type MilestoneListData = {
  items: Array<{
    id: EntityId;
    projectId: EntityId;
    phaseId: EntityId | null;
    name: string;
    date: ISODateTime;
    status: "pending" | "done" | "missed";
    isOverdue: boolean;
  }>;
};
```

`isOverdue = status != done AND date < asOf`。没有日期范围时默认返回未来 90 天及已经错过但仍未完成的里程碑。

### 7.6 `plm_bom_get_risks`

用途：返回 BOM 齐套率与风险物料，不让模型自行解释原始状态列表。

```ts
type BomGetRisksInput = {
  projectId: EntityId;
  phaseId?: EntityId;
  riskTypes?: Array<"delayed" | "critical_not_arrived" | "eta_overdue" | "eta_within_window">;
  windowDays?: number;           // 1..90，默认 14
  cursor?: Cursor;
  limit?: number;
};

type BomGetRisksData = {
  kitRate: {
    totalItemRows: number;
    arrivedItemRows: number;
    percent: number;
    assemblyReady: boolean;
    calculationMethod: "arrived_row_count";
    byStatus: Record<string, number>;
  };
  risks: Array<{
    id: EntityId;
    mpn: string;
    name: string;
    status: string;
    quantity: number;
    isCritical: boolean;
    eta: ISODateTime | null;
    phaseId: EntityId | null;
    reasonCodes: Array<"delayed" | "critical_not_arrived" | "eta_overdue" | "eta_within_window">;
  }>;
};
```

齐套率与当前服务一致：按 BOM 条目行数计算 `Arrived / total`，不是按数量、金额或关键度加权。Tool 必须返回 `kit_rate_is_row_based` warning，直至业务确认新的齐套算法。

### 7.7 `plm_change_get_impact`

```ts
type ChangeGetImpactInput = {
  changeRef: string;             // 精确 ECR/ECO 编号或实体 ID，1..100
  changeType?: "ECR" | "ECO" | "AUTO";
  includeApprovals?: boolean;    // 默认 true；只返回允许展示的姓名/动作
};

type ChangeGetImpactData = {
  change: {
    id: EntityId;
    type: "ECR" | "ECO";
    number: string;
    projectId: EntityId;
    title: string | null;
    status: string;
    changeCategory: string;
    reason: string | null;
    versionFrom: string | null;
    versionTo: string | null;
    sourceEcr?: { id: EntityId; number: string } | null;
    convertedEco?: { id: EntityId; number: string } | null;
  };
  impacts: Array<{
    impactId: EntityId;
    entityType: "BOM_ITEM" | "TASK" | "TECH_SPEC" | "PRODUCT";
    entityId: EntityId;
    label: string;
    note: string | null;
  }>;
  approvals: Array<{
    action: string;
    approverName: string;
    comment: string | null;
    createdAt: ISODateTime;
  }>;
};
```

ECR 本身没有影响项时，返回空数组；若已转换 ECO，可返回 `convertedEco`，但不会把 ECO 影响静默当作 ECR 原生字段。影响实体标签解析失败时保留 ID 并返回 warning，不编造名称。

### 7.8 `plm_document_search`

用途：搜索有权限的工程文档并返回可引用的版本片段。

```ts
type DocumentSearchInput = {
  query: string;                 // 2..500
  projectId?: EntityId;         // 省略 = 全部可见项目
  includeShared?: boolean;       // 默认 true；受公共文档策略约束
  categories?: string[];
  tags?: string[];
  retrievalMode?: "auto" | "lexical" | "hybrid";
  cursor?: Cursor;
  limit?: number;                // 默认 10，最大 30
};

type DocumentSearchData = {
  retrievalModeUsed: "lexical" | "hybrid";
  indexVersion: string;
  items: Array<{
    documentId: EntityId;
    projectId: EntityId | null;
    title: string;
    category: string | null;
    documentVersion: number;
    chunkId: string;
    sectionPath: string[];
    excerpt: string;
    score: number | null;
    updatedAt: ISODateTime;
  }>;
};
```

v1 首发只允许 `lexical`；请求 `hybrid` 返回 `tool_disabled`，不得假装已做语义检索。阶段 5 的 `document_lexical_v2` 使用确定性 Markdown 标题路径和最多 1200 个 Unicode 字符的持久片段，响应 excerpt 仍最多 500 字符。索引仅保存文档最新版；文档事务写入 Outbox，独立索引器幂等替换片段。

召回前按当前 `Documents.projectId` 过滤，不信任片段表中的 ACL 快照；因此移除项目成员后，即使旧片段尚未消费失效事件，也不能返回。`projectId = null` 是公共文档，可被具有 `kb:read` 的登录用户检索；`includeShared = false` 时排除。索引延迟 warning 只能统计调用方可见范围，不得泄露其他项目的待处理数量。

提示注入模式检测只产生结构化 warning，不把文档升级为控制面，也不保证识别所有攻击。每个 item 必须对应 `document_chunk` 证据；内容中的命令和提示始终只作为不可信引用文本处理。

### 7.9 `plm_org_get_tree`（阶段 6 已启用）

```ts
type OrgGetTreeInput = {
  rootOrgUnitId?: EntityId;
  depth?: 1 | 2 | 3 | 4 | 5;    // 默认 3
  includeInactive?: boolean;     // 默认 false
};

type OrgGetTreeData = {
  nodes: Array<{
    id: EntityId;
    parentId: EntityId | null;
    code: string;
    name: string;
    manager: { id: EntityId; name: string } | null;
    activeMemberCount: number;
    status: "active" | "inactive";
  }>;
};
```

`OrgUnit`、负责人子树授权和成员可见字段策略已在阶段 6 落地。普通成员只看到本人主部门基本信息，负责人看到所负责组织子树，管理员看到全量；员工明细不由本 Tool 返回。

### 7.10 `plm_org_list_members`（阶段 6 已启用）

```ts
type OrgListMembersInput = {
  orgUnitId: EntityId;
  recursive?: boolean;           // 默认 false
  projectId?: EntityId;          // 可选，与项目成员关系取交集
  cursor?: Cursor;
  limit?: number;
};

type OrgListMembersData = {
  items: Array<{
    userId: EntityId;
    name: string;
    orgUnitId: EntityId;
    orgUnitName: string;
    positionName: string | null;
    managerId: EntityId | null;
    status: "active" | "inactive";
  }>;
};
```

默认不返回邮箱、工号、手机号和工时。若公司采用矩阵组织，本契约需在实现前增加成员关系有效期与主/兼职标识。

### 7.11 `plm_member_get_workload`（P1）

```ts
type WorkloadScope =
  | { type: "users"; userIds: EntityId[] }
  | { type: "project"; projectId: EntityId }
  | { type: "org_unit"; orgUnitId: EntityId; recursive?: boolean };

type MemberGetWorkloadInput = {
  scope: WorkloadScope;
  dateFrom: DateOnly;
  dateTo: DateOnly;              // 最大 92 天
  projectId?: EntityId;          // 对 users/org_unit 进一步取项目交集
  includeTaskDetails?: boolean;  // 默认 false，最多 20 条/人
};

type MemberGetWorkloadData = {
  calculationMethod: "workload_v1";
  rankingMetric: "open_estimated_hours" | "planned_hours_in_window" | "none";
  members: Array<{
    userId: EntityId;
    name: string;
    openTaskCount: number;
    openEstimatedHours: number;
    loggedHoursInWindow: number;
    capacityHoursInWindow: number | null;
    plannedHoursInWindow: number | null;
    utilizationPercent: number | null;
    dataQuality: "complete" | "partial" | "insufficient";
    missingFields: string[];
  }>;
};
```

规则：

- `time:read` 只允许本人；项目/多人/组织范围必须有 `time:read_all`，并叠加项目或组织权限。
- 当前 `estimatedHours` 是开放任务存量，不是按时间窗分配的计划工时。没有产能和分时计划时，`utilizationPercent` 必须为 `null`。
- 只有 `dataQuality != insufficient` 且 `rankingMetric != none` 时，Agent 才能给出对应口径的排序；不得把“开放预估工时最多”表述为“利用率最高”。

### 7.12 `plm_report_generate_weekly`（P1）

```ts
type ReportGenerateWeeklyInput = {
  projectId: EntityId;
  weekStart: DateOnly;
  sections?: Array<"progress" | "completed" | "risks" | "milestones" | "bom" | "changes" | "workload">;
  format?: "structured" | "markdown"; // 默认 structured
};

type ReportGenerateWeeklyData = {
  period: { start: DateOnly; end: DateOnly; timezone: string };
  project: { id: EntityId; code: string; name: string };
  snapshot: {
    progress: {
      percent: number;
      completedTasks: number;
      totalTasks: number;
      calculationMethod: "done_task_count";
    };
    completedTasks: Array<{
      id: EntityId;
      title: string;
      assigneeName: string | null;
      completedAt: ISODateTime;
    }>;
    openRisks: Array<{
      code: "blocked_task" | "overdue_task" | "delayed_bom" | "missed_milestone";
      severity: "warning" | "critical";
      summary: string;
      evidenceIds: string[];
    }>;
    upcomingMilestones: Array<{
      id: EntityId;
      name: string;
      date: ISODateTime;
      status: string;
    }>;
    bom: {
      kitRatePercent: number;
      calculationMethod: "arrived_row_count";
      riskCount: number;
    } | null;
    changes: Array<{
      id: EntityId;
      type: "ECR" | "ECO";
      number: string;
      action: string;
      occurredAt: ISODateTime;
    }>;
    workload: Array<{
      userId: EntityId;
      name: string;
      openEstimatedHours: number;
      loggedHoursInWindow: number;
      capacityHoursInWindow: number | null;
      utilizationPercent: number | null;
    }> | null;
  };
  draftMarkdown: string | null;
  omittedSections: Array<{ section: string; reason: string }>;
};
```

周报 Tool 负责产生确定性数据包和可选模板草稿；Agent 可以润色，但不得添加数据包外的完成项或风险。`completedAt/occurredAt` 必须来自结构化 `ActivityEvent`，不能用实体当前 `updatedAt` 或当前 `Done` 状态猜测。阶段 5 已为任务完成、ECR/ECO 流转和文档变更追加事务内活动事件；部署前历史不回填，时间窗无事件时完成项/变更项为空并写入 `omittedSections/warnings`。

`progress/openRisks/upcomingMilestones/bom` 明确是响应 `asOf` 时刻的当前快照，不声称代表整个周内的历史状态。阶段 6 前 `workload = null`，并在 `omittedSections` 说明缺少时间窗产能/计划工时口径。

## 8. 成功响应示例

```json
{
  "ok": true,
  "contractVersion": "1.0",
  "tool": "plm_project_get_summary",
  "requestId": "req_01",
  "traceId": "trace_01",
  "data": {
    "project": {
      "id": "project-id",
      "code": "CAM-01",
      "name": "相机模组项目",
      "status": "active",
      "lifecycleStage": "RD",
      "owner": { "id": "user-id", "name": "项目负责人" },
      "startDate": "2026-06-01T00:00:00+08:00",
      "endDate": "2026-10-31T00:00:00+08:00"
    },
    "progress": {
      "percent": 60,
      "completedTasks": 12,
      "totalTasks": 20,
      "calculationMethod": "done_task_count",
      "formula": "round(completedTasks / totalTasks * 100)",
      "emptyProjectValue": 0
    },
    "health": {
      "level": "red",
      "ruleSetVersion": "project_health_v1",
      "blockedTaskCount": 1,
      "overdueTaskCount": 2,
      "delayedBomCount": 0,
      "reasonCodes": ["blocked_tasks", "overdue_tasks"]
    }
  },
  "evidence": [
    {
      "evidenceId": "ev_project_1",
      "kind": "entity",
      "entityType": "PROJECT",
      "entityId": "project-id",
      "projectId": "project-id",
      "label": "CAM-01 相机模组项目",
      "uri": "/projects/project-id",
      "version": { "type": "updated_at", "value": "2026-08-12T09:00:00+08:00" }
    },
    {
      "evidenceId": "ev_progress_1",
      "kind": "aggregate",
      "entityType": "PROJECT",
      "entityId": "project-id",
      "projectId": "project-id",
      "label": "任务完成率聚合",
      "version": { "type": "snapshot", "value": "2026-08-12T10:00:00+08:00" }
    }
  ],
  "asOf": "2026-08-12T10:00:00+08:00",
  "scope": {
    "projectIds": ["project-id"],
    "permissionsApplied": ["project:read", "dashboard:read"],
    "redactions": []
  },
  "warnings": [
    {
      "code": "progress_is_task_count_based",
      "message": "该进度按已完成任务数计算，不代表工时或成本进度。"
    }
  ]
}
```

示例中的名称、ID 和数字仅用于说明 Schema，不是当前数据库事实或测试结果。

## 9. 失败响应示例

```json
{
  "ok": false,
  "contractVersion": "1.0",
  "tool": "plm_project_get_summary",
  "requestId": "req_02",
  "traceId": "trace_02",
  "error": {
    "code": "resource_not_accessible",
    "message": "目标资源不存在或当前账号无权访问。",
    "retryable": false
  },
  "asOf": "2026-08-12T10:01:00+08:00"
}
```

## 10. 审计、性能与数据最小化

每次调用至少记录：

- `runId/traceId/requestId/toolName/contractVersion`；
- 当前用户主体的内部引用、权限结果和涉及项目 ID；
- 输入的结构化摘要或散列，敏感字段按策略脱敏；
- 开始/结束时间、状态、错误码、重试次数、返回条数和证据 ID；
- Tool schema 版本、算法/规则版本和部署版本。

不得记录：密码、会话令牌、数据库连接串、服务密钥、完整外部模型认证头。是否记录完整问题/回答由企业保留策略决定，默认审计应可仅保存摘要与散列。

初始执行限制建议：普通 Tool 5 秒、文档检索 8 秒、周报数据包 15 秒；这些是待压测的配置起点，不是已验证指标。超时不得退化为无权限查询、原始 SQL 或无界重试。

## 11. v1 写操作边界

> 本文仍是 12 个只读 Tool 的 v1 契约。阶段 7 新增的 proposal Tool 与浏览器执行协议单独发布为 [PLM Action Tool Contract v1](./PLM_ACTION_TOOL_CONTRACT_V1.md)，没有给任何现有读 Tool 增加隐藏副作用。

v1 不注册任何业务写 Tool。未来写能力不得通过给现有读 Tool 增加隐藏副作用实现，而应单独发布契约并至少包含：

1. `proposalId` 和字段级 before/after；
2. 目标实体 `expectedVersion`；
3. 风险等级和所需权限；
4. 有过期时间的 `approvalRequestId`；
5. 由 UI 人工确认生成的一次性执行授权；
6. `idempotencyKey`；
7. 执行前重新鉴权与版本校验；
8. 事务内业务审计；
9. 执行后回读证据。

最终执行接口不作为普通模型 Tool 暴露。删除、审批、发布、ECO 实施和批量导入仍需在专项 ADR 中决定。

## 12. Contract 验收清单

- [x] 所有 Tool input/output 都能由同一 Zod 源生成并通过 JSON Schema 校验。
- [x] input 不包含用户、角色、权限、可见范围或原始查询表达式。
- [x] 非成员/停用/权限撤销/跨项目 ID 的权限矩阵通过，且不可枚举资源存在性。
- [x] Tool Adapter 与 MCP Adapter 对同一输入得到相同数据、证据和权限裁剪。
- [x] 进度、健康度、逾期、齐套率等算法与本文一致并有固定夹具测试。
- [x] 列表分页稳定、无重复/遗漏，limit、时间窗和文本长度上限有效。
- [x] 所有成功结果包含 `asOf/scope/warnings`，主要结论有 evidence。
- [x] 文档检索返回实际版本和片段；项目权限变化后不可继续召回旧权限内容。
- [x] 禁用 Tool 返回 `tool_disabled/data_not_ready`，Agent 不通过其他 Tool 猜测结果。
- [x] v1 注册表中所有 Tool 的副作用为 `none`，运行前后业务表无变化。
- [x] 错误响应不泄露 SQL、堆栈、内部路径、凭据或其他项目数据。
- [x] 每次调用的 Agent Run 审计与 Tool 超时/可重试行为已验证；阶段 3 已验证 Run 取消、检查点恢复、租约接管和有界停止。

## 13. 已确认契约决策

- [x] 暴露名称采用 `plm_*` snake_case，并由同一契约映射内部调用与 MCP。
- [x] 项目进度 v1 固定为任务数完成率并展示 warning。
- [x] BOM 齐套率 v1 保持当前条目行数口径并展示 warning；数量/关键度加权另立算法版本。
- [x] `includeShared` 默认 true，公共文档保持当前已登录可见语义；策略由服务端配置且必须回归测试。
- [x] 新增 `org:read`；组织首版采用一人一个主部门，跨职能关系使用项目成员关系。
- [x] 负载遵循 `time:read/time:read_all` 与项目/组织范围；产能不足时 `utilizationPercent = null`。
- [x] 周报在结构化活动数据就绪前保持禁用，不从当前快照猜测历史变化。
- [x] v1 完全只读；所有写操作另立契约和 ADR。
