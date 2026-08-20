# WorkBuddy 云端部署说明

## 架构边界

正式形态为 Electron/浏览器通过 HTTPS 访问 Next.js Web/API，再由 Web/API 访问 PostgreSQL。桌面包不直连数据库，不保存业务数据库副本，也不提供离线双向同步。

## 必备资源

1. 与 PostgreSQL 同区域或邻近区域的容器运行平台。
2. PostgreSQL 16 预生产与生产实例，生产开启 TLS、自动备份/PITR 和最小权限应用账号。
3. 正式域名、DNS 与可信 HTTPS 证书。
4. 部署平台 Secret：至少包含 `DATABASE_URL`、32 字节以上随机 `AUTH_SECRET`、`AUTH_TRUST_HOST=true`。
5. 生产网关登录限流；设置 `DEPLOYMENT_ENV=production` 与 `AUTH_RATE_LIMIT_MODE=gateway`。共享存储适配器尚未实现，不能用环境变量假装已具备。
6. Agent 未独立验收前保持数据库总开关关闭，不配置真实模型密钥。

变量清单见 `.env.production.example`。任何真实密码、连接串或 Token 都不得写入镜像、仓库、桌面包和构建日志。

## 镜像与迁移

```powershell
docker build --target runner -t workbuddy-plm:1.0.2 .
docker build --target migration -t workbuddy-plm-migration:1.0.2 .
```

发布前先备份并在预生产执行 migration 镜像：

```powershell
docker run --rm --env DATABASE_URL="$env:DATABASE_URL" workbuddy-plm-migration:1.0.2
```

禁止对现有业务库执行 `prisma db push`、`npm run setup` 或 demo seed。现有库若不是由 migration 创建，必须先在恢复副本核对 baseline，再按 `docs/DATABASE_OPERATIONS.md` 处理。

## 健康检查

- `GET /api/health/live`：仅证明 Node/Next 进程可响应。
- `GET /api/health/ready`：检查运行配置并执行 PostgreSQL `SELECT 1`；任一失败返回 503，响应不包含 Secret 或原始数据库错误。

反向代理、负载均衡和桌面配置应以 ready 探针作为接流依据。上线后抽检：

```powershell
Invoke-RestMethod https://plm.example.com/api/health/live
Invoke-RestMethod https://plm.example.com/api/health/ready
```

## 隔离 UAT

`docker-compose.uat.yml` 只能用于本机或 CI 的可丢弃数据库 `workbuddy_uat`：

```powershell
$env:UAT_POSTGRES_PASSWORD = '<至少24位，只使用大小写字母、数字、点、下划线、波浪线和连字符>'
$env:UAT_AUTH_SECRET = '<至少 32 字节的一次性随机值>'
docker compose -f docker-compose.uat.yml up --build -d
```

该编排不会自动执行 demo seed。只有确认目标数据库为 `workbuddy_uat` 后，才允许显式启用一次性 seed profile：

```powershell
docker compose -f docker-compose.uat.yml --profile demo-seed run --rm seed
```

本机 Playwright 可通过 `127.0.0.1:${UAT_DB_PORT:-55432}` 访问该隔离库。停止服务不会自动删除数据卷；删除验收卷属于破坏性操作，必须先核对项目名和卷名。

## Render Singapore 内部 UAT（推荐）

根目录 `render.yaml` 用一个 Blueprint 创建以下资源：

- Singapore 区域的 Starter Web Service：`workbuddy-plm-uat`；
- 同区域 PostgreSQL 16：`workbuddy-plm-uat-db`，Basic 256 MB、5 GB 磁盘且禁止公网数据库访问；
- 每次部署先执行 `prisma migrate deploy`，ready 探针通过后才接流；
- 仅第一次成功部署执行受保护的 demo seed，后续部署不会重复清库。

首次部署步骤：

1. 在 Render 选择 **New > Blueprint**，连接 GitHub 仓库的 `main` 分支并读取 `render.yaml`。
2. 创建前只需填写 `DEMO_SEED_PASSWORD`：使用独立强密码，不得复用个人或生产密码。`AUTH_SECRET` 由 Render 自动生成，`DATABASE_URL` 由数据库资源注入。
3. 暂不绑定正式域名，内部测试直接使用 Render 分配的 `*.onrender.com` HTTPS 地址。
4. 首次部署完成后访问 `/api/health/live` 和 `/api/health/ready`，二者都应返回成功。
5. 使用 `admin@demo.com` 和第 2 步的密码首次登录，由管理员创建内部测试人员账号，再按验收清单检查 admin、pm、engineer、viewer 权限。

该环境明确标记为 `DEPLOYMENT_ENV=uat`，没有宣称生产网关限流能力。数据库是可丢弃的内部测试库；录入有效测试数据后，不得手工重跑 `npm run db:seed`，因为 seed 会清空 UAT 业务表。Agent 默认保持关闭，Blueprint 不接收模型密钥。

Render 回滚应用时选择上一成功部署；数据库迁移仍遵循 expand/contract，不用回滚应用代替数据库恢复。正式生产部署需另建数据库、域名、网关限流和备份/PITR 策略，不能直接把该 UAT Blueprint 改名复用。

## 发布与回滚

1. 备份生产数据库并保存 SHA-256 与抽样摘要。
2. 运行 migration，确认零 schema drift。
3. 部署新 Web/API，ready 通过后逐步接流。
4. 完成 admin/pm/engineer/viewer 真实 HTTPS 验收。
5. 出现应用故障时将流量切回上一镜像；数据库迁移遵循 expand/contract，不在事故中盲目执行逆向 DDL。
6. 桌面端仅在正式域名稳定后写入 `PLM_SERVER_URL` 重新构建，并完成 Authenticode 双版本升级/回退。
