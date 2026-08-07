# PLM 研发协同平台

公司级轻量级 **PLM + 项目管理 + 工程知识库** 一体化平台，面向软硬件协同研发团队。
基于《个人项目管理应用开发文档》的架构与数据模型扩展为公司级多角色系统。

## 功能总览

| 模块 | 能力 |
|---|---|
| Dashboard 大盘 | 统计卡片（在研项目/待办阻塞/物料延迟/近7天ECO/知识库活跃度）、项目健康度 🟢🟡🔴、未来14天 Deadline 时间轴、变更统计 |
| 项目管理 | 立项与计划、WBS 父子任务、看板/表格/甘特三视图、FS 依赖连线（检环）、里程碑、工时登记、成员负载视图 |
| PLM | 产品结构树（产品→部件→物料）、跨项目物料库、产品版本历史、生命周期阶段流转（概念/研发/试产/量产/停产，含守卫规则） |
| BOM 跟踪 | 齐套率实时计算（100% 高亮「具备装配条件」）、Delayed 卡脖子物料自动 Block 组装任务并可自动恢复、CSV/Excel 导入（字段映射）、CSV 导出 |
| 技术参数库 | Target vs Actual 自动判定 🟢/🔴（gte/lte/eq）、Markdown + Mermaid 状态机/流程图、固件版本绑定 |
| 工程变更 | ECR（申请→提交→审批）→ ECO（草稿→审批→实施→关闭）两级流转、自动递增单号（ECO-2026-001）、影响面追溯、垂直时间轴、Markdown 变更报告导出 |
| 工程知识库 | 分类与标签、文档版本历史、FTS5 全文检索（Ctrl+K 全局穿透 任务/MPN/参数/ECO/文档） |
| 权限体系 | RBAC：系统管理员/项目经理/研发工程师/访客，模块级权限点 + 项目级数据权限（ProjectMember，可项目内覆盖角色） |
| 审计 | 全量操作审计日志（含自动 Block/恢复联动记录） |

## 技术栈

- Next.js 14 (App Router) + React 18 + TypeScript + Ant Design 5
- Prisma ORM + SQLite（零依赖本地运行；schema 方言中立，可平滑迁 PostgreSQL）
- NextAuth v5（Credentials + JWT）、bcryptjs
- dnd-kit（看板拖拽）、frappe-gantt（甘特）、mermaid（流程图/状态机）、@uiw/react-md-editor + react-markdown、recharts、papaparse + SheetJS

## 快速开始

```bash
npm install          # 安装依赖（自动 prisma generate）
npm run setup        # 初始化数据库 + 写入演示数据（prisma db push && db seed）
npm run dev          # 启动 http://localhost:3000
```

> 数据库文件：`prisma/dev.db`（SQLite，路径见 `.env` 的 `DATABASE_URL`，已带 `connection_limit=1` 单连接参数）。重置数据：`npm run setup` 会清空并重新写入演示数据（含全文索引重建）。

> **排障**：若启动后写入报 `attempt to write a readonly database`（多见于沙箱/杀毒软件环境对 SQLite 文件的句柄占用），先停掉所有 node 进程，删除 `prisma/dev.db` 后重新执行 `npm run setup` 与 `npm run start`；若仍复现，将整个项目复制到其他磁盘再运行。在正常开发机上按上述命令即可直接使用。

### 演示账号（密码均为 `Demo@123456`）

| 账号 | 角色 | 权限概要 |
|---|---|---|
| admin@demo.com | 系统管理员 | 全部权限 + 用户管理 + 审计日志 |
| pm@demo.com | 项目经理 | 项目/任务/变更审批/PLM 管理 |
| eng@demo.com | 研发工程师 | 本人任务、BOM/参数/知识库编辑、ECR 提交 |
| guest@demo.com | 访客 | 各模块只读 + BOM 导出 |

## 演示数据亮点

- **TH-100 智能温控器**（EVT 阶段）：2 颗 Delayed 卡脖子物料（ESP32 模组、SHT31 传感器）已自动 Block「样机贴片组装」任务——把物料状态改为 Arrived 可观察任务自动恢复；齐套率约 70%。
- ECO-2026-001（PCB V1.0→V1.1 已实施）、ECR-2026-001（待审批，可走完整 ECR→ECO 流转）。
- 知识库 5 篇含 Mermaid 状态机与代码块，Ctrl+K 可全文检索正文。
- GW-20 BLE 网关项目用于验证多项目与项目级数据权限（guest 仅可见 TH-100）。

## 快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl/Cmd + K | 全局搜索（穿透 任务/BOM MPN/技术参数/ECO 单号/知识库） |
| Ctrl/Cmd + N | 新建任务 / 新建物料（在对应页面） |
| Space | 表格视图勾选聚焦行（批量更新） |

## 目录结构

```
prisma/            schema.prisma（24 表，原文档 6 表名原样保留）+ seed.ts
src/
  app/             页面（(auth)/login、(main)/dashboard|projects|plm|knowledge|resources|admin）+ api/ 路由
  components/      layout / tasks / bom / common 等 UI 组件
  lib/
    constants.ts   全部枚举与权限矩阵（SQLite 无 enum，应用层约束）
    rbac.ts        requireAuth / requirePerm / 项目级数据权限
    services/      业务规则层（齐套率、联动 Block、ECR/ECO 状态机、生命周期机、FTS 搜索…）
```

## 迁移 PostgreSQL

schema 未使用 SQLite 独有特性：修改 `prisma/schema.prisma` 的 `provider = "postgresql"` 与 `.env` 的 `DATABASE_URL`，重跑 `prisma migrate dev` 即可；全文检索需将 FTS5 虚表替换为 `tsvector`（`lib/services/searchService.ts` 单点封装，已内置 LIKE 降级）。
