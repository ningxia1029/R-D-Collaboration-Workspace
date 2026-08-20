# 阶段 8 验收记录：评测治理与生产验收

日期：2026-08-13；真实模型补充验证：2026-08-20
本地环境：Windows / Node.js 24.12.0 / WSL Ubuntu 22.04 / PostgreSQL 14.23 恢复实例 / PostgreSQL 16 全链路 E2E
结论：**本地工程门禁通过；生产验收 NO-GO，阶段保持进行中**

## 已实现范围

- 建立 `enterprise-agent-eval@1.0.0` 固定评测集，共 68 条：schema 28、权限 16、提示注入 12、治理 12。
- 建立确定性评测 harness、成本/证据 judge、Provider Adapter 微基准和 Chromium 桌面/移动安全 E2E。
- CI 固定 Node 24.12.0，编排质量、PostgreSQL 16 migration/恢复及 Windows 桌面 smoke 三类作业。
- Next.js 升级到 15.5.23，Auth.js 升级到 beta.32，SheetJS 改用官方 0.20.3 CDN 包；生产与全量 npm audit 均清零。
- 建立 dry-run 默认、数据库名与精确数量双确认的 Agent 保留清理工具。
- 桌面正式发布增加签名 provenance、签名校验、干净提交与产物哈希门禁；未签名包只能作为 smoke 证据。
- 形成部署、回滚/恢复、事故响应、模型切换、数据保留/删除及生产验收手册。
- 接入官方 DeepSeek V4 Flash 非思考模式，补齐标准 Tool 消息历史、结构化消歧控制 Tool、可信项目上下文和脱敏 live eval Harness。
- 增加项目解析运行时硬门禁和一次性 PostgreSQL 16 全链路 E2E，覆盖登录、Run、独立 Worker、HTTP 控制面、真实 Tool Gateway、数据库与 SSE。

## 本地自动验证

| 门禁 | 命令或方法 | 结果 |
|---|---|---|
| 类型与 schema | `npm run typecheck -- --incremental false`、Worker typecheck、`npx prisma validate` | 通过 |
| 单元/契约 | `npm test` | 123/123 通过 |
| 依赖审计 | `npm audit --json`、`npm audit --omit=dev` | 0 critical / high / moderate / low |
| 固定评测 | `npm run agent:eval` | 68/68；权限泄露 0；未确认写入 0；证据覆盖率 100%；确定性成本 0 |
| 生产构建 | `npm run build` | Next.js 15.5.23；48/48 页面生成 |
| 浏览器安全 | `npm run test:e2e` | Chromium desktop + Pixel 5，4/4 通过 |
| Adapter 微基准 | `npm run agent:benchmark` | 最终复跑 5,000 次；P95 0.439ms；0 错误；0 模型成本 |
| 数据库恢复 | 可丢弃 PostgreSQL 14.23 源库/恢复库 | 9/9 migration、5/5 在线索引、governance 负例、零 drift、7 类数据摘要一致 |
| 桌面 smoke | 隔离输出目录构建、哈希/zip/秘密文件回查 | Electron 43.4.0；exe/zip 哈希一致；2,706 entries；环境文件 0 |
| 真实模型 smoke | `npm run agent:eval:live` | 8/8 完整执行；7/8 通过；三项安全指标为 0；已知失败为部分名称无候选后仍尝试摘要，执行前被 allowlist 阻断 |
| 真实模型 full | `npm run agent:eval:live -- --full` | 90/90 完整；87/90、96.7%；权限泄露 0、敏感数据泄露 0、未确认写入 0；P50 2,216ms、P95 3,690ms、最大 4,386ms；成本 5,971 微美元；门禁 PASS |
| Agent 全链路 E2E | 双确认的一次性 PostgreSQL 16 + `tests/e2e/agent-runtime-full.spec.ts` | 1/1；真实登录、Run API、Worker、HTTP 控制面、真实 Tool Gateway、PostgreSQL 与 SSE 闭环；TH-999 解析失败后项目业务 Tool 0 次 |

数据库备份 SHA-256：`89699aac8f11c4ff2d6613d80de6de4efe786dfe74a46433991adabf6bf2357a`。
恢复比较摘要：`77d6387fc552b1fd6a5ec3e313f81be1f36fee97c9ce7e1446ae9956977c40b4`。
最终桌面 exe SHA-256：`05ee7b29bf2e16ba32efedee0abce8b463be44944b3c3a272f6ae498d254d90f`。
最终桌面 zip SHA-256：`2a7c15fa3b2b1690eb4c4957a9b4b78ab64c6ad77283de1657df9ab18db59acf`。

## 证据边界

- 浏览器用例验证未登录边界、安全响应头、API 401 与窄屏横向溢出，不等同于真实企业账号的完整业务 RBAC UAT。
- deterministic 微基准不代表真实性能；DeepSeek live 指标包含真实模型和网络但只使用合成 Tool；PostgreSQL 16 全链路使用 fake acceptance Provider。两类证据不能拼接成真实模型的产品端到端 P95。
- 恢复演练使用本机隔离 PostgreSQL 14.23；GitHub Actions 的 PostgreSQL 16 作业只是已配置，尚无远端成功记录。
- 桌面包 `codeSigned=false`、内外层 Authenticode 均为 `NotSigned`、`signedExecutables=[]`，且 provenance 为 `sourceDirty=true`；未执行 tag、push 或 Release。
- DeepSeek V4 Flash 非思考 Provider/Harness 已完成脱敏基线，隔离 Web→Worker→真实 Tool Gateway→PostgreSQL/SSE 已用确定性 Provider 通过；尚未完成修复后的 DeepSeek full 复测、真实模型产品端到端 P95/成本、思考模式、企业 IdP、生产域名/证书、SIEM、正式代码签名证书和两版可回退安装包。

## NO-GO 阻断与关闭标准

1. 在受控 PostgreSQL 16 预生产环境运行 migration、恢复、drift 和代表性规模验证。
2. 接入批准的企业 IdP 与真实模型，完成数据驻留、密钥、账号生命周期、脱敏评测及端到端 P95/成本阈值签署。
3. 对真实 HTTPS 域名执行证书、反向代理、TLS 和日志/SIEM 验收。
4. 从干净已评审提交构建两个企业签名版本，完成升级、失败回退、哈希与签名验证。
5. 项目负责人完成真实业务 UAT，并书面确认 Release。

以上五项全部有可回查证据前，ALG-43、Agent 主任务和相关 WorkBuddy 交付范围不得标记完成。

真实模型详细证据：[DeepSeek V4 Flash live eval](./PHASE_8_DEEPSEEK_V4_FLASH_LIVE_EVAL.md)。
