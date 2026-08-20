# WorkBuddy Self-Hosted UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 办公电脑上以独立 Docker Compose 项目运行 WorkBuddy Next.js、PostgreSQL 16、一次性迁移/seed、Cloudflare Tunnel 与每日校验备份，供少量内部人员通过 HTTPS 验收。

**Architecture:** `cloudflared` 与 `app` 只共享前端网络，`app`、迁移、备份与 PostgreSQL 只共享后端网络；数据库不发布宿主机端口，应用仅绑定 `127.0.0.1:3010` 供本机诊断。真实 Secret 只写入被 Git 忽略的 `.env.selfhost`；Cloudflare 使用独立 remotely-managed tunnel token，不复用现有 `cf-tunnel` 容器。PostgreSQL 使用全新命名卷，备份以原子文件、SHA-256 与保留期管理。

**Tech Stack:** Docker Desktop Compose v5、Node.js 24 standalone、PostgreSQL 16、Prisma migrate、Cloudflare `cloudflared`、PowerShell、POSIX shell、Node test runner。

---

### Task 1: Self-host Compose 与 Secret 门禁

**Files:**
- Create: `docker-compose.selfhost.yml`
- Create: `.env.selfhost.example`
- Create: `scripts/new-selfhost-env.ps1`
- Create: `scripts/validate-selfhost-env.ts`
- Modify: `.gitignore`
- Modify: `tests/deployment-artifacts.test.ts`

- [ ] **Step 1: 先添加失败的部署契约测试**

在 `tests/deployment-artifacts.test.ts` 添加测试，读取以上四个新文件并断言：Compose 名称为 `workbuddy-selfhost`；使用 `postgres:16`；数据库名固定 `workbuddy_selfhost_uat`；数据库没有 `ports`；app 只绑定 `127.0.0.1:${SELFHOST_APP_PORT:-3010}:3000`；存在 `frontend`/`backend` 隔离网络；Cloudflare 使用独立 profile、`TUNNEL_TOKEN` 与固定镜像 digest；迁移先于 app；seed 只在 `demo-seed` profile；环境模板中的 Secret 为空；生成脚本使用加密随机数且拒绝覆盖；预检校验数据库密码、Auth Secret、备份周期和保留期；文件中不包含公开密码、Neon URL 或 tunnel token。

- [ ] **Step 2: 运行测试并确认因文件缺失而失败**

Run: `node node_modules/tsx/dist/cli.mjs --test tests/deployment-artifacts.test.ts`

Expected: 新测试因 `docker-compose.selfhost.yml` 不存在而失败，原有部署测试保持通过。

- [ ] **Step 3: 实现最小 Compose 与 Secret 生成**

`docker-compose.selfhost.yml` 必须定义：

```yaml
name: workbuddy-selfhost

services:
  preflight:
    build: { context: ., target: uat-tools }
    command: ["npx", "tsx", "scripts/validate-selfhost-env.ts"]
    restart: "no"
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: workbuddy_selfhost_uat
      POSTGRES_USER: workbuddy_selfhost
      POSTGRES_PASSWORD: ${SELFHOST_POSTGRES_PASSWORD}
    volumes:
      - workbuddy_selfhost_pgdata:/var/lib/postgresql/data
    networks: [backend]
    restart: unless-stopped
  migrate:
    build: { context: ., target: migration }
    environment:
      DATABASE_URL: postgresql://workbuddy_selfhost:${SELFHOST_POSTGRES_PASSWORD}@db:5432/workbuddy_selfhost_uat
    networks: [backend]
    restart: "no"
  seed:
    profiles: ["demo-seed"]
    build: { context: ., target: uat-tools }
    command: ["npm", "run", "db:seed"]
    environment:
      NODE_ENV: uat
      DEMO_SEED_ALLOW: "1"
      DEMO_SEED_TARGET_ACK: workbuddy_selfhost_uat
      DEMO_SEED_PASSWORD: ${SELFHOST_DEMO_PASSWORD}
    networks: [backend]
    restart: "no"
  app:
    build: { context: ., target: runner }
    ports:
      - "127.0.0.1:${SELFHOST_APP_PORT:-3010}:3000"
    environment:
      DEPLOYMENT_ENV: uat
      AUTH_RATE_LIMIT_MODE: isolated-uat
      AUTH_TRUST_HOST: "true"
      NEXT_PUBLIC_DEMO_MODE: "false"
    networks: [frontend, backend]
    restart: unless-stopped
  tunnel:
    profiles: ["tunnel"]
    image: cloudflare/cloudflared@sha256:0aa26e284f05e6c77ae375b8c9c11d9eb6a448fb7bcd8d40f31cb6176189eb38
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:-}
    networks: [frontend]
    restart: unless-stopped

networks:
  frontend:
  backend:
    internal: true

volumes:
  workbuddy_selfhost_pgdata:
```

在实际文件中补齐 healthcheck、`depends_on`、`no-new-privileges`、capability drop 和有界日志配置。`.env.selfhost.example` 只包含空 Secret 与非敏感默认值。`new-selfhost-env.ps1` 使用 `RandomNumberGenerator` 生成 URL-safe PostgreSQL 密码、至少 32 字节 Auth Secret 和符合共享密码策略的 demo 密码，以无 BOM UTF-8 原子写入 `.env.selfhost`，存在时默认拒绝覆盖且不输出 Secret。`validate-selfhost-env.ts` 在任何容器写操作前 fail closed。

- [ ] **Step 4: 运行目标测试和 Compose 静态解析**

Run: `node node_modules/tsx/dist/cli.mjs --test tests/deployment-artifacts.test.ts`

Run: `docker compose --env-file .env.selfhost.example -f docker-compose.selfhost.yml config --quiet`

Expected: 契约测试全部通过；Compose 只因空 Secret 的预期插值策略保持可解析，不创建容器或卷。

- [ ] **Step 5: 显式暂存 Task 1 文件并提交**

```powershell
git add -- docker-compose.selfhost.yml .env.selfhost.example scripts/new-selfhost-env.ps1 scripts/validate-selfhost-env.ts .gitignore tests/deployment-artifacts.test.ts docs/superpowers/plans/2026-08-20-self-hosted-uat.md
git commit -m "deploy: add isolated self-hosted UAT stack"
```

### Task 2: 自动备份、恢复门禁与运行手册

**Files:**
- Create: `scripts/selfhost-backup.sh`
- Create: `scripts/selfhost-restore.sh`
- Create: `docs/SELF_HOSTED_UAT.md`
- Modify: `docker-compose.selfhost.yml`
- Modify: `.gitignore`
- Modify: `tests/deployment-artifacts.test.ts`

- [ ] **Step 1: 先添加失败的备份/恢复契约测试**

断言备份脚本使用 `set -eu`、`umask 077`、`pg_dump --format=custom --no-owner --no-acl`、`.partial` 后原子 `mv`、`sha256sum`、有界保留期和 `find` 清理；恢复脚本验证 basename、同名 SHA-256、`pg_restore --list`，默认只检查，只有 `RESTORE_EXECUTE=1` 且 `RESTORE_TARGET_ACK=workbuddy_selfhost_uat` 时才允许 `--clean --if-exists --exit-on-error --single-transaction`。Compose 的 backup 服务只在 backend，挂载 `./backups/selfhost:/backups`，restore 使用显式 profile 和只读备份挂载。

- [ ] **Step 2: 运行测试并确认因脚本缺失而失败**

Run: `node node_modules/tsx/dist/cli.mjs --test tests/deployment-artifacts.test.ts`

Expected: 新备份契约因 `scripts/selfhost-backup.sh` 不存在而失败。

- [ ] **Step 3: 实现备份、恢复与文档**

备份容器首次启动立即产生一份 custom archive 和同名 `.sha256`，成功后按 `SELFHOST_BACKUP_INTERVAL_SECONDS` 休眠；失败退出并由 `restart: unless-stopped` 重试。只删除同时具有 `.dump` 与 `.sha256`、且超过 `SELFHOST_BACKUP_RETENTION_DAYS` 的自身命名文件。恢复服务默认执行归档与 hash 检查，不写库。

`docs/SELF_HOSTED_UAT.md` 必须覆盖：架构与现有资源隔离；生成 Secret；首次启动 migration；一次性 demo seed 的破坏性边界；本地 live/ready；Cloudflare remotely-managed tunnel、独立 token、published hostname 指向 `http://app:3000`；建议先配 Access Allow policy；备份路径和 dry-run 恢复；停止服务不删卷；明确禁止 `down -v`；应用回滚与数据库恢复分离；办公电脑必须常开。

- [ ] **Step 4: 运行部署契约和 shell 语法验证**

Run: `node node_modules/tsx/dist/cli.mjs --test tests/deployment-artifacts.test.ts`

Run: `docker run --rm -v ${PWD}/scripts:/scripts:ro postgres:16 sh -n /scripts/selfhost-backup.sh`

Run: `docker run --rm -v ${PWD}/scripts:/scripts:ro postgres:16 sh -n /scripts/selfhost-restore.sh`

Expected: 契约测试全绿，两个 shell 脚本语法检查退出 0。

- [ ] **Step 5: 显式暂存 Task 2 文件并提交**

```powershell
git add -- scripts/selfhost-backup.sh scripts/selfhost-restore.sh docs/SELF_HOSTED_UAT.md docker-compose.selfhost.yml .gitignore tests/deployment-artifacts.test.ts
git commit -m "ops: add verified self-hosted database backups"
```

### Task 3: 全新卷真实验证与 Cloudflare 交付

**Files:**
- Modify only if verification exposes a tested defect in Task 1/2 files.

- [ ] **Step 1: 生成被忽略的本地 Secret 文件并检查不被 Git 跟踪**

Run: `powershell -ExecutionPolicy Bypass -File scripts/new-selfhost-env.ps1`

Run: `git status --short --ignored .env.selfhost backups/selfhost`

Expected: `.env.selfhost` 存在且显示为 ignored；命令输出不包含任何 Secret 值。

- [ ] **Step 2: 确认精确目标后创建全新 Compose 资源**

Run: `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml config --quiet`

Run: `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up --build -d db migrate app`

Expected: 只创建 `workbuddy-selfhost_*` 容器、网络与 `workbuddy-selfhost_workbuddy_selfhost_pgdata` 卷；既有 `cf-tunnel` 和 `workbuddy-uat_workbuddy_uat_pgdata` 保持原状态。

- [ ] **Step 3: 执行一次性 seed 并启动备份**

Run: `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml --profile demo-seed run --rm seed`

Run: `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d backup`

Expected: seed 仅在明确 profile 下执行；备份目录生成非空 `.dump` 与匹配 `.sha256`。

- [ ] **Step 4: 验证本地健康、容器边界与恢复 dry-run**

Run: `Invoke-RestMethod http://127.0.0.1:3010/api/health/live`

Run: `Invoke-RestMethod http://127.0.0.1:3010/api/health/ready`

Run: `$backupName = (Get-ChildItem .\backups\selfhost\workbuddy-*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name; docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml --profile restore run --rm -e BACKUP_FILE=$backupName restore`

Expected: live/ready 返回成功；恢复只列出归档、不执行写入；数据库没有宿主机端口；app 以非 root 运行。

- [ ] **Step 5: 由用户创建独立 remotely-managed Tunnel 后启动 profile**

用户在 Cloudflare 创建 `workbuddy-plm-uat` tunnel 和 published application route，hostname 使用用户确认的域名，Service URL 固定 `http://app:3000`；将独立 tunnel token 仅写入 `.env.selfhost`。建议在发布 route 前建立 Cloudflare Access Allow policy，否则公网将直接到达应用登录页。

Run: `docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml --profile tunnel up -d tunnel`

Expected: 新容器名属于 `workbuddy-selfhost`，Tunnel 为 healthy；既有 `cf-tunnel` 不重启、不重建。

- [ ] **Step 6: HTTPS 冒烟与完整项目验证**

Run: `$env:WORKBUDDY_PUBLIC_HOSTNAME = Read-Host '请输入已在 Cloudflare 保存的 WorkBuddy hostname'; Invoke-RestMethod "https://$env:WORKBUDDY_PUBLIC_HOSTNAME/api/health/live"`

Run: `Invoke-RestMethod "https://$env:WORKBUDDY_PUBLIC_HOSTNAME/api/health/ready"`

Run: `npm test`

Run: `npm run typecheck`

Run: `git diff --check`

Expected: HTTPS 健康检查成功；所有项目测试和类型检查通过；工作树只包含计划内提交与被忽略的本机 Secret/备份。
