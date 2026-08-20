# 生产验收清单

## 自动化门禁

- [x] `npm run test`：122/122 通过（含账号生命周期、文档权限范围与状态 CAS 回归）。
- [x] `npm run typecheck -- --incremental false`：通过。
- [x] `npx prisma validate`：通过。
- [x] `npm run build`：通过。
- [x] Electron 主进程、更新器、桌面构建与发布脚本语法检查通过。
- [x] `npm audit --audit-level=high`：0 个漏洞。
- [ ] API 集成测试覆盖关键 RBAC、事务回滚和并发状态流转。
- [x] Playwright 四角色真实写操作 UAT：2026-08-20 在本机隔离 PostgreSQL 16 `workbuddy_uat` 通过 1/1；远端 `workbench-rbac-uat` CI 首次成功记录仍待取得。

## 数据库

- [x] 本机隔离 PostgreSQL 16 已执行 `migrate deploy`，识别 10 个迁移且无待应用迁移。
- [x] 本机 UAT 从空库完成迁移、受控 demo seed 与应用启动演练。
- [ ] 执行备份、SHA-256 校验、隔离恢复和业务数据抽样。
- [ ] 验证旧数据上的追溯关联使用实体 ID；修复历史上可能写入 MPN 的记录。

## 权限与安全

- [x] 四角色 × 成员/非成员核心读写矩阵：隔离 PostgreSQL 16 已覆盖项目可见性、管理员建用户/首次改密、PM 项目与任务、工程师本人任务及 BOM/ECR/ECO/知识库/评论、工程师他人任务/改派拒绝、viewer 与非成员 403。
- [ ] 停用用户和降权用户的现有 JWT 立即失效验证。
- [ ] XSS、跨项目 ID、批量 ID 混入、恶意 Mermaid/搜索摘要回归。
- [ ] 网关级限流、HTTPS、Cookie/CSRF 和生产密钥轮换完成。
- [ ] 依赖漏洞已清零或经书面风险接受。

## 桌面与发布

- [ ] 使用 HTTPS `PLM_SERVER_URL` 构建，无数据库连接串/认证密钥落入产物。
- [ ] 便携版与绿色版在干净 Windows 机器启动、登录、托盘和外链行为正常。
- [ ] Release 包含 exe、zip、`SHA256SUMS.txt`、`BUILD-PROVENANCE.json` 四项资产，版本、HEAD 与哈希一致。
- [ ] 从旧版本检查更新、下载、哈希校验、打开新包、失败回退全流程通过。
- [ ] 正式发布、推送和团队交付已获得明确授权。

### 2026-08-08 本机预验收（不替代生产验收）

- [x] `PLM-Workspace-v1.0.1-portable.exe` 与绿色版均打开可响应的“配置 PLM 服务”窗口。
- [x] `dist/win-unpacked/resources/app` 中 `.env*` 文件数为 0，公开配置未包含数据库与认证密钥。
- [x] EXE/ZIP 的 SHA-256 与 `SHA256SUMS.txt`、`BUILD-PROVENANCE.json` 三方一致。
- [ ] Authenticode：`NotSigned`；当前 provenance 为 `sourceDirty=true`，仅可用于本轮验包，禁止正式 Release。
- [ ] 当前未提供正式 HTTPS WorkBuddy 服务地址，登录与业务流程未验收。

### 2026-08-13 工作台体验与权限增量（不替代生产验收）

- [x] `npm test`：74/74；四角色权限策略新增回归覆盖。
- [x] `npm run typecheck` 与 `npm run build`：通过，45/45 页面生成。
- [x] 项目状态/产品/日期/描述编辑入口、生命周期说明和自动进度口径已补齐。
- [x] 项目列表 N+1 统计与工程变更重复项目请求已消除。
- [x] viewer 的任务/BOM/评论写控件已隐藏或禁用；engineer 本人任务边界与项目成员负责人下拉已对齐。
- [x] NSIS 构建输出确认包含欢迎页和解压页；解压前可取消，并解释解压期间关闭暂时禁用。
- [x] 新 EXE/ZIP 哈希与 `SHA256SUMS.txt`、`BUILD-PROVENANCE.json` 一致，包内 `.env*` 为 0。
- [ ] 新包仍未签名，`sourceDirty=true` 且 `serverUrl` 为空；不得作为正式 Release。
- [ ] 四角色对共享云端环境仅完成项目可见性只读抽查；任务、BOM、ECR/ECO、知识库和评论写操作需在隔离验收库完成。

### 2026-08-20 云端部署与账号生命周期增量（不替代公网生产验收）

- [x] 最新源码 Docker runner 重建成功；Next.js 48/48 页面生成，standalone 环境文件数为 0。
- [x] PostgreSQL 16 UAT 容器、迁移容器和应用容器启动成功；`/api/health/live` 返回 `live`，`/api/health/ready` 返回 `ready`。
- [x] 管理员创建账号、强制首次改密、密码策略、会话版本撤销和并发改密 CAS 已实现并通过自动化测试；未开放公共自助注册。
- [x] 四角色真实写操作 UAT 本机通过 1/1；远端 GitHub Actions 尚未运行，不能记为 CI 通过。
- [ ] 正式云平台、域名、DNS、TLS、生产网关限流、密钥轮换和企业 IdP 尚未配置。
