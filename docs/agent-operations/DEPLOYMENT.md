# Agent 部署与验收手册

## 1. 发布前置条件

1. 使用干净、已评审的 Git 提交；工作树脏或 provenance 指向其他提交时禁止发布。
2. Node.js 22–26；当前 CI 固定 24.12.0。
3. PostgreSQL 16 的独立预生产库已完成备份、恢复、权限和性能演练。
4. 应用入口、模型入口和桌面配置均为 HTTPS；生产数据库连接启用证书校验。
5. 企业 IdP、数据驻留、日志保留和敏感字段策略已有负责人签署。
6. Windows 正式产物使用企业代码签名证书和可信时间戳；绿色 zip 内主程序与便携外层 exe 必须分别签名并写入 provenance，未签名 smoke 包不得进入 Release。

## 2. 必需配置

密钥只进入部署平台 Secret，不写入仓库、镜像、日志或桌面包：

```text
DATABASE_URL
AUTH_SECRET
DEPLOYMENT_ENV=production
AUTH_RATE_LIMIT_MODE=gateway
AGENT_INTERNAL_SERVICE_SECRET
AGENT_DELEGATION_SECRET
AGENT_CURSOR_SECRET
AGENT_ACTION_APPROVAL_SECRET
AGENT_RUNTIME_BASE_URL
AGENT_MODEL_PROVIDER=openai-compatible
AGENT_MODEL_BASE_URL
AGENT_MODEL_API_KEY
AGENT_MODEL_NAME
```

生产必须保持 `NEXT_PUBLIC_DEMO_MODE` 未设置或为 `false`。四个 Agent HMAC/认证密钥至少 32 字节并相互独立。
生产 readiness 只接受已落地的网关限流模式；`isolated-uat` 仅可用于明确标记的隔离 UAT，不能用于正式流量。

## 3. 自动门禁

```powershell
npm ci
npm audit --audit-level=high
npx prisma validate
npm run typecheck -- --incremental false
npm test
npm run agent:eval
npm run agent:benchmark
npm run build
npm run standalone:prepare
npm run test:e2e
```

通过标准：依赖漏洞为 0；单元/契约测试全通过；固定评测不少于 50 条且权限泄露、未确认写入均为 0；构建、standalone 环境文件检查和浏览器门禁通过。`agent:benchmark` 仅是本机 Adapter 基准，不替代真实模型端到端压测。

## 4. 数据库部署

先在同版本预生产备份，再执行 expand-only 迁移：

```powershell
npx prisma migrate deploy
$env:AGENT_INDEX_TARGET_ACK='<准确数据库名>'
npm run db:agent-indexes
npx prisma migrate deploy
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
```

禁止对生产执行 `prisma db push`、seed 或 `npm run setup`。五个 `CONCURRENTLY` 索引必须逐项回查 `valid/ready`。迁移失败时停止应用推广，不在未知状态下重跑破坏性命令。

## 5. 发布顺序

1. 部署 Web/API，Agent 总开关保持关闭。
2. 验证认证、RBAC、审计、SSE、Tool allowlist、未登录 401 和维护页。
3. 部署独立 Worker；先用批准的测试账号运行只读问答和故障降级。
4. 开启只读 Tool；观察错误率、P95、token/成本、审计缺口和越权告警。
5. Action proposal 单独开启；执行接口仍只接受产品确认卡的本人短时授权。
6. 完成人工验收并记录负责人后才允许正式流量。

## 6. 发布后抽检

- Run、Tool、Action proposal、业务审计可用同一 correlation/trace 串联。
- 关闭总开关后，排队/等待 Run 立即取消，运行中 Run 收到取消请求。
- 模型不可用时 Run 有界失败，WorkBuddy 主业务仍可使用。
- 真实问题的关键结论均能回到 evidence URI、版本和 `asOf`。
- 日志不包含密码、token、API key、原始模型密钥或未脱敏业务正文。

## 7. 2026-08-20 本机容器证据

- Docker runner 使用最新源码构建成功，Next.js 48/48 页面生成，standalone 未携带 `.env*`。
- `workbuddy_uat` 使用 PostgreSQL 16，10 个迁移均已应用；应用与数据库容器健康。
- `/api/health/live` 与 `/api/health/ready` 分别返回 `live`、`ready`。
- 上述仅证明容器化和本机隔离 UAT 可行；正式云平台、HTTPS 域名、生产 Secret、网关和可观测性仍需外部环境验收。
