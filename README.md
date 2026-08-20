# PLM 研发协同平台

面向软硬件协同研发团队的轻量级 PLM、项目管理与工程知识库工作台。

## 当前能力

- 项目与任务：WBS、看板/表格/甘特、依赖检环、里程碑、工时与资源负载。
- PLM 与 BOM：产品结构、物料主数据、版本、齐套率、关键物料延迟联动。
- 工程变更：ECR → ECO 状态机、影响范围、审批记录与审计。
- 知识库：Markdown/Mermaid、版本历史、项目范围搜索。
- 权限：NextAuth、全局 RBAC、项目成员角色覆盖和实体级项目归属校验。
- 研发智能体：独立 LangGraph Worker、只读 Tool Gateway、Run/SSE 工作台、版本化文档片段与活动事件周报，以及经人工确认的低风险任务字段更新；生产门禁仍未完成。

## 安全的本地开发

要求 Node.js 22–26、PostgreSQL 和独立的开发数据库。

```powershell
npm ci
npm audit --audit-level=high
npm run typecheck -- --incremental false
npm run test
npm run agent:eval
npm run dev
```

必须通过环境变量提供 `DATABASE_URL` 与高强度 `AUTH_SECRET`。`.env` 不得提交。`npm run setup` 会执行 seed，只允许用于可丢弃的演示库，严禁对现有业务库运行。

数据库迁移、备份与恢复见 `docs/DATABASE_OPERATIONS.md`。

## 研发智能体进程

复制 `.env.agent.example` 中的配置到受保护环境。Web、Agent Worker 与文档索引器是三个独立职责：

```powershell
npm run dev
npm run agent:worker
npm run agent:knowledge-indexer
```

真实模型预验收使用独立脱敏数据集，默认只跑 8 条 smoke；完整模式为 30 条 × 3 次。API Key 只能通过当前进程或 Secret Manager 注入，不得写入仓库：

```powershell
$env:AGENT_MODEL_PROVIDER = "openai-compatible"
$env:AGENT_MODEL_BASE_URL = "https://api.deepseek.com"
$env:AGENT_MODEL_NAME = "deepseek-v4-flash"
$env:AGENT_MODEL_THINKING = "disabled"
npm run agent:eval:live
npm run agent:eval:live -- --full
```

完整报告只保存 case ID、决策类型、Tool 名、参数键、失败分类、延迟、token 和成本，不保存问题、回答、Tool 参数值或推理内容。详见 [模型切换手册](./docs/agent-operations/MODEL_SWITCH.md)。

首次部署阶段 5 索引前，先完成备份、迁移和目标库确认，再按 [知识片段迁移说明](./docs/agent-migrations/20260813_AGENT_KNOWLEDGE_CHUNKS.md) 受控执行一次 `--backfill --once`。不要把本地 fake provider、验收数据库命令或 `npm run setup` 用于生产。

启用受控 Action Agent 还必须配置独立的 `AGENT_ACTION_APPROVAL_SECRET`。最终执行接口不暴露给模型；动作协议、风险边界和迁移步骤见 [Action Tool Contract](./docs/PLM_ACTION_TOOL_CONTRACT_V1.md) 与 [迁移说明](./docs/agent-migrations/20260813_AGENT_ACTION_CONTROL.md)。

## 桌面版

桌面客户端默认只加载 HTTPS 服务端，通过构建环境变量配置：

```powershell
$env:PLM_SERVER_URL = "https://plm.example.com"
$env:PLM_UPDATE_FEED = "https://github.com/ningxia1029/R-D-Collaboration-Workspace/releases/latest"
npm run build:desktop
```

桌面产物不内嵌数据库连接串或认证密钥。构建输出采用固定英文名：

- `PLM-Workspace-v<version>-portable.exe`
- `PLM-Workspace-v<version>-green.zip`
- `SHA256SUMS.txt`
- `BUILD-PROVENANCE.json`（源码提交、工作树状态、构建时间与产物哈希）

未在构建时设置 `PLM_SERVER_URL` 时，首次启动会打开配置页，要求输入管理员提供的 HTTPS 工作台地址；没有已部署的服务端时，客户端只能完成安装包与配置页验收，不能完成业务登录验收。

更新器只从 GitHub Release 下载，并在提示用户打开新包前验证 SHA-256。当前采用安全的手动切换包策略，不对正在运行的便携外壳做原地覆盖。

## 验证与发布

```powershell
npm audit --audit-level=high
npm run test
npm run typecheck -- --incremental false
npx prisma validate
npm run agent:eval
npm run agent:eval:live
npm run agent:benchmark
npm run build
npm run standalone:prepare
npm run test:e2e
```

CI 设计为在 Ubuntu/Node 24 执行质量与 PostgreSQL 16 恢复门禁，并在 Windows 生成未签名桌面 smoke 产物。工作流已配置，但只有 GitHub Actions 实际运行成功后才能作为远端 CI 证据。`npm run release -- <x.y.z>` 会创建 tag、推送并发布资产，属于外部写操作，只能在评审通过且明确授权后运行。

## 当前发布门禁

- 2026-08-13 本地 `npm audit` 与生产依赖审计均为 0，但远端 CI 尚未实跑。
- 隔离 PostgreSQL 14.23 已完成 9/9 migration、备份恢复与零 drift；仍需在 PostgreSQL 16 预生产环境复验。
- Chromium 桌面/移动未登录安全门禁通过；企业 IdP、真实模型、真实 HTTPS/TLS、SIEM 与代表性端到端性能仍待验收。
- 当前桌面 smoke 包未签名，工作树非干净提交；必须完成两个签名版本的升级/回滚与用户签署，发布脚本才允许执行。

完整清单见 [阶段 8 生产验收矩阵](./docs/agent-operations/PRODUCTION_ACCEPTANCE.md)，部署与处置步骤见 [运行手册索引](./docs/agent-operations/README.md)。
