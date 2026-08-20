# 阶段 3：Agent Runtime 与 Harness 验收记录

| 属性 | 结果 |
|---|---|
| 日期 | 2026-08-12 |
| 状态 | **Codex 验收通过** |
| 范围 | 独立 Worker、LangGraph、Provider Adapter、租约/心跳/取消/检查点、短期委托、内部 Gateway |
| 数据库 | 可丢弃 WSL PostgreSQL 14.23，`127.0.0.1:55441/workbuddy_phase3_20260812j` |
| 清理 | `PHASE3_CLEANUP_OK`，实例停止且临时目录已删除 |

## 1. 已实现

- 独立 `agent-worker` TypeScript 进程边界；Worker 只依赖内部 Runtime/Tool HTTP 协议，不导入 Prisma、不读取业务数据库连接串。
- 精确锁定 `@langchain/langgraph 1.4.9`、`@langchain/core 1.2.5`、`zod 3.25.76`；均为 MIT。
- LangGraph 状态图覆盖 `PLAN → EXECUTE_TOOL → PLAN → ANSWER` 和 `WAITING_FOR_USER`，每个节点输出可移植检查点。
- Provider Adapter 覆盖 deterministic fake 与 OpenAI-compatible `/chat/completions` 协议、结构化 Tool call、usage 和能力探测。
- PostgreSQL `FOR UPDATE SKIP LOCKED` 租约、版本 fencing、心跳、取消、时限、步数/Tool/token/结果字节预算和终态 CAS。
- 短期 HMAC 委托 token 绑定 `runId/traceId/sessionId/subject/audience/expiry`；Gateway 注入受信身份并拒绝跨 Run requestId。
- 内部接口使用独立 Bearer 服务密钥；模型和浏览器均不能提供用户身份字段。

## 2. 验收命令与结果

### 单元、边界与双 Node 版本

```powershell
npm test
npm run typecheck
npx tsc --noEmit -p agent-worker/tsconfig.json
$node22 node_modules\tsx\dist\cli.mjs --test tests\agent-runtime.test.ts tests\agent-tools.test.ts
```

- Node 24.12.0 全仓：`45/45` 通过。
- Node 22.22.2 Agent Runtime + Tool：`29/29` 通过。
- Worker 静态边界：8 个源文件均无 Prisma/`DATABASE_URL`。
- Prisma schema 与 Web/Worker TypeScript 均通过。

### 隔离 PostgreSQL 故障恢复

```powershell
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55441/workbuddy_phase3_20260812j?schema=public'
npx prisma migrate deploy
$env:AGENT_INDEX_TARGET_ACK='workbuddy_phase3_20260812j'
npm run db:agent-indexes
npx prisma migrate status
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
$env:AGENT_RUNTIME_VERIFY_TARGET_ACK='workbuddy_phase3_20260812j'
$env:AGENT_RUNTIME_VERIFY_ALLOW_DESTRUCTIVE='1'
npm run db:agent-runtime-verify
```

- 5/5 migrations applied；5/5 online indexes created；schema `No difference detected`。
- 有效租约期间第二 Worker 无法领取；租约过期后版本递增并安全接管。
- 模拟 Worker 突然退出后，从最后成功检查点恢复；Tool 仅执行 1 次，Tool 审计 `records=1`。
- `SUCCEEDED/CANCELLED/WAITING_FOR_USER` 三类终态实际落库。
- 恢复测试产生 7 个检查点、14 个事件；业务表快照前后完全一致。

### 生产构建与依赖审计

```powershell
npm run build
npm audit --omit=dev --audit-level=low
```

- Next.js 生产构建成功，39/39 静态页；两个内部 Agent API 路由进入构建产物。
- 构建时 npm registry 曾连接复位，Next 未能第一次自动补 lockfile 的跨平台 SWC 条目；随后使用现有 lockfile/本机依赖完成构建。这不证明离线冷启动安装。
- 依赖审计仍为 `6 vulnerabilities (4 high, 2 critical)`：既有 Auth.js/Next/PostCSS/xlsx 风险；阶段 8 发布门禁必须关闭。

## 3. 运行时版本决策

Node 官方发布计划显示 Node 20 于 2026-04-30 EOL。继续把企业新 Worker 锁在 Node 20 会失去安全维护，因此本阶段把生产范围设为 Node `>=22 <27`：

- Node 22.22.2（Maintenance LTS）已实测；
- Node 24.12.0（Active LTS）已实测；
- Node 26 当前未作为生产推荐，虽在 engine 范围内但尚未完成本项目实测。

## 4. 能证明与不能证明

可以证明：单 Worker 架构、allowlist Tool、租约/恢复/取消/预算、委托防篡改、Node 22/24 行为、PostgreSQL 真实迁移与状态落库符合阶段 3 契约。

不能证明：未配置真实模型供应商凭据，因此没有外部模型端到端调用、真实 token 成本或数据驻留证据；未部署独立 Worker 服务、TLS/网络策略与进程监管；UI/SSE/会话恢复属于阶段 4；现存高危依赖使当前产物仍不具备生产发布资格。
