# WorkBuddy 云端生产就绪实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 WorkBuddy PLM 从“本机验收包 + 云数据库演示”推进到具备可部署云端服务、受控企业账号生命周期、PostgreSQL 16 四角色写操作验收和正式发布门禁的状态。

**Architecture:** 业务继续采用云端集中式架构：Electron 仅作为 HTTPS 薄客户端，Next.js Web/API 作为唯一业务入口，PostgreSQL 作为唯一事实源。本阶段不引入本地业务数据库或离线双向同步，避免在缺少冲突契约时制造数据分叉。

**Tech Stack:** Next.js 15、NextAuth 5、Prisma 5、PostgreSQL 16、Electron 43、Docker、Playwright、Node test。

**Spec:** `docs/PRODUCTION_HARDENING_PLAN.md`、`docs/agent-operations/DEPLOYMENT.md`、`docs/ACCEPTANCE_CHECKLIST.md`

## Global Constraints

- 不对现有 Neon/生产数据库执行 seed、`prisma db push`、破坏性迁移或测试写入。
- 数据库写操作验收只能使用名称明确、可丢弃的隔离 PostgreSQL 数据库。
- 桌面包不得包含 `DATABASE_URL`、`AUTH_SECRET` 或 `.env*`。
- 不开放公共自助注册；企业账号由管理员创建，首次登录必须修改临时密码。
- 当前脏工作树中的既有用户改动必须保留；本计划不自动暂存、提交、推送或发布。
- 没有正式域名、部署平台 Secret 和 Authenticode 证书时，只能完成部署材料和本地/隔离验收，不能宣称生产上线。

---

### Task 1: 云端运行门禁和健康检查

**Files:**
- Create: `src/lib/runtimeReadiness.ts`
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `tests/runtime-readiness.test.ts`

**Interfaces:**
- Produces: `inspectRuntimeReadiness(env)`，返回不包含秘密值的检查结果。
- Produces: `/api/health/live` 进程存活探针与 `/api/health/ready` 配置/数据库就绪探针。

- [ ] 编写失败测试，覆盖缺失 `DATABASE_URL`、弱 `AUTH_SECRET`、生产演示模式和合法配置。
- [ ] 实现纯函数运行配置检查，禁止在响应或日志输出秘密值。
- [ ] 实现 live/ready 路由；ready 使用 `SELECT 1` 验证 PostgreSQL，失败返回 HTTP 503。
- [ ] 运行 `npm test` 与 `npm run typecheck`。

### Task 2: 可复现容器部署材料

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `.env.production.example`
- Create: `docker-compose.uat.yml`
- Create: `docs/CLOUD_DEPLOYMENT.md`
- Create: `tests/deployment-artifacts.test.ts`
- Create: `scripts/seed-uat.ts`

**Interfaces:**
- Consumes: `/api/health/ready`。
- Produces: Node 24 非 root standalone 镜像和 PostgreSQL 16 隔离 UAT 编排。

- [ ] 编写多阶段 Dockerfile，生产层仅复制 standalone、static 和 public。
- [ ] 排除 `.env*`、Git、测试输出、旧桌面产物和本机依赖。
- [ ] 提供不含真实密钥的生产环境模板，明确所有 Secret 只能由部署平台注入。
- [ ] 提供仅用于可丢弃验收库的 Compose，数据库名称固定为 `workbuddy_uat`。
- [ ] demo seed 必须通过数据库名和 `UAT_SEED_TARGET_ACK` 双确认，且只能显式启用 profile。
- [ ] 文档化部署、迁移、健康检查、回滚和禁止 seed/db push 的边界。
- [ ] 若本机 Docker 可用，执行 `docker compose config` 与镜像构建；不可用则明确记录未验证。

### Task 3: 企业账号首次改密和会话撤销

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820000000_account_lifecycle/migration.sql`
- Create: `src/lib/passwordPolicy.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/auth.config.ts`
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/lib/rbac.ts`
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/(main)/admin/users/page.tsx`
- Create: `src/app/api/account/change-password/route.ts`
- Create: `src/app/(auth)/change-password/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `prisma/seed.ts`
- Create: `tests/account-lifecycle.test.ts`

**Interfaces:**
- Produces: `validatePassword(password)`。
- Produces: `User.mustChangePassword`、`User.passwordChangedAt`、`User.sessionVersion`。
- Produces: `POST /api/account/change-password`。

- [ ] 先写密码策略和会话版本行为的失败测试。
- [ ] 添加 expand-only 字段；现有账号默认不强制改密，新建/重置账号显式强制改密。
- [ ] 登录 JWT 记录 `mustChangePassword` 和 `sessionVersion`；数据库版本变化后旧会话立即失效。
- [ ] 中间件强制临时密码账号只能进入改密页。
- [ ] 改密接口验证旧密码、强密码和禁止复用，更新审计并撤销旧会话。
- [ ] 演示 seed 账号显式设为无需改密，防止自动验收被阻断。
- [ ] 运行单测、Prisma validate、类型检查和生产构建。

### Task 4: PostgreSQL 16 四角色真实写操作 UAT

**Files:**
- Create: `tests/e2e/workbench-rbac.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `playwright.config.ts`
- Modify: `docs/ACCEPTANCE_CHECKLIST.md`

**Interfaces:**
- Consumes: 演示 seed 的 admin、pm、engineer、viewer 和 `workbuddy_uat` 隔离库。
- Produces: UI 可见性、允许写操作、viewer/非成员越权拒绝的 Playwright 证据。

- [ ] 覆盖四角色登录和项目成员可见性。
- [ ] 在隔离库验证 admin/pm 项目与任务管理、engineer 本人任务/BOM/ECR/ECO/知识库权限。
- [ ] 验证 viewer 评论和所有业务写入返回 403，非成员项目返回 403/不可见。
- [ ] CI 新增 PostgreSQL 16 隔离作业，作业内才允许 `migrate deploy` 和 demo seed。
- [ ] 本机可用时在独立 `workbuddy_uat` 库复跑；不得指向现有 Neon。

### Task 5: 完整门禁、交付记录和外部阻断收口

**Files:**
- Modify: `docs/agent-operations/DEPLOYMENT.md`
- Modify: `docs/agent-operations/PRODUCTION_ACCEPTANCE.md`
- Modify: `交付进度报告-2026-08-07.md`

**Interfaces:**
- Consumes: Tasks 1–4 的测试、构建、数据库和产物证据。

- [ ] 运行 `npm audit --audit-level=high`、Prisma validate、typecheck、单测、Agent eval、Next build 和可执行的 E2E。
- [ ] 检查 `git diff --check`、工作树、产物秘密边界和签名状态。
- [ ] 更新报告，严格区分已实现、已验证、待外部部署和生产阻断。
- [ ] 同步既有 Notion ALG-23，不重复创建任务，状态保持保守。
- [ ] 若缺少正式 HTTPS 域名/平台权限、密钥轮换权限或签名证书，列出最小输入并停止外部变更；不得伪造上线完成。
