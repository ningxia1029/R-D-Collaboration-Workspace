# PLM Action Tool Contract v1

| 属性 | 内容 |
|---|---|
| 状态 | **Approved** |
| 版本 | 1.0 |
| 日期 | 2026-08-13 |
| 适用范围 | 低风险任务字段更新提议与人工确认执行 |

## 1. 不变量

- proposal Tool 与最终执行端点是两个不同信任域。
- 模型上下文不得收到 `approvalToken`、nonce、会话凭据或执行端点描述。
- proposal 成功只表示“待确认”，不得表述为任务已更新。
- 每次执行都重新鉴权、检查 `expectedVersion`，并以数据库事务产生回读和双审计。
- 未在动作注册表中同时标为 `enabled + LOW` 的动作一律拒绝。

## 2. 模型可见 Tool

### `plm_action_propose_task_update`

副作用：`proposal`，只新增或幂等返回 Agent 治理记录，不写 `Tasks`。

输入：

```ts
{
  taskId: string;
  changes: {
    description?: string | null;      // <= 10,000 字符
    priority?: "P0" | "P1" | "P2" | "P3";
    dueDate?: "YYYY-MM-DD" | null;
    estimatedHours?: number | null;   // 0..100000
  };
  reason?: string;                    // <= 500 字符
  idempotencyKey: string;             // 8..128 字符
}
```

禁止字段包括 `status/title/assigneeId/phaseId/parentId/ecoId/isMilestone/sortOrder`，也禁止 `userId/role/projectIds/permissionCodes/sql/where/approvalToken`。Schema 为 strict，多余字段直接返回 `validation_error`。

成功数据：

```ts
{
  proposalId: string;
  approvalRequestId: string;
  actionType: "TASK_UPDATE_LOW_RISK";
  status: "PENDING";
  riskLevel: "LOW";
  target: { taskId: string; projectId: string; title: string };
  before: Record<string, string | number | null>;
  after: Record<string, string | number | null>;
  expectedVersion: string;
  expiresAt: string;
  confirmationRequired: true;
  executionToolExposedToModel: false;
}
```

## 3. 浏览器专用执行协议

`POST /api/agent/actions/{proposalId}/execute` 不是 Tool。请求必须来自当前登录用户：

```ts
{
  approvalToken: string;
  confirmationText: "确认执行";
  expectedVersion: string;
}
```

令牌使用 HMAC-SHA256，绑定 `proposalId/userId/nonceHash/expectedVersion/exp`；最长有效 10 分钟，且不得超过提议到期时间。提议状态与唯一执行键负责一次消费，重放只回读已持久化结果。

成功回读：

```ts
{
  proposalId: string;
  status: "EXECUTED";
  executionIdempotencyKey: string;
  readback: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    priority: string;
    dueDate: string | null;
    estimatedHours: number | null;
    updatedAt: string;
  };
  auditCorrelationId: string;
  replayed: boolean;
}
```

## 4. 状态机

```text
PENDING ──确认且全部复核通过──> EXECUTED
   ├──用户取消───────────────> CANCELLED
   ├──超过 expiresAt─────────> EXPIRED
   ├──权限/目标不可访问──────> REJECTED
   ├──expectedVersion 变化───> CONFLICT
   └──提议结构不可恢复────────> FAILED
```

终态不可执行。`APPROVED` 为数据模型兼容保留值，本协议 v1 不以其作为可写中间态。

## 5. 错误语义

| 条件 | HTTP / Tool 语义 | 业务副作用 |
|---|---|---|
| Tool strict schema 失败 | `validation_error` | 0 |
| 提议幂等键异内容 | `conflict` | 0 |
| 令牌缺失/损坏 | 400 | 0 |
| 令牌、版本或提议过期 | 409 | 0 |
| 他人提议 | 404 | 0 |
| 权限撤销 | 403，`PERMISSION_REVOKED` | 0 |
| 目标版本变化 | 409，`EXPECTED_VERSION_MISMATCH` | 0 |
| 并发同提议 | 一个执行，一个 `replayed=true` | 仅 1 次 |

## 6. 审计契约

- proposal：`AgentToolExecution.requestId` 唯一，输入只保存散列和摘要。
- approval：`AgentApprovalRequest` 保存提议、预期版本、终态、失败码、执行结果与回读。
- business：`AuditLog.correlationId = approvalRequestId`，字段差异为 proposal 的 before/after。
- activity：`ActivityEvent.correlationId = approvalRequestId`，事件为 `task.agent_updated`。

## 7. 明确禁用

`TASK_DELETE / CHANGE_APPROVE / PRODUCT_RELEASE / ECO_IMPLEMENT / BULK_IMPORT` 均不注册模型 Tool、没有执行 handler。提示词、文档内容、MCP 客户端或自报角色都不能改变该注册表。
