# 阶段 8 生产验收矩阵

日期：2026-08-20
本地环境：Windows / Node 24.12.0 / PostgreSQL 16（Docker 隔离 UAT）
结论：**NO-GO；本地工程、容器与核心四角色 UAT 通过，公网生产门禁未全部完成**

| 门禁 | 当前结论 | 证据或阻断 |
|---|---|---|
| 版本化评测 | 本地通过 | 68/68；权限泄露 0；未确认写入 0；证据元数据覆盖 100% |
| 单元/契约 | 本地通过 | 主应用与 Worker 类型检查、Prisma validate 通过；122/122 测试通过 |
| 依赖安全 | 本地通过 | `npm audit` 与 `npm audit --omit=dev` 均为 0 |
| Next 生产构建 | 本地通过 | Next 15.5.23，48/48 页面生成；Docker standalone 环境文件 0 |
| 浏览器安全 | 本地通过 | Chromium 桌面/移动 4/4；未登录页面/API、CSP/安全头、横向溢出 |
| 数据库迁移/恢复 | 隔离 PG14 通过 | 9/9 migration、5/5 在线索引、备份 SHA-256、双库 7 类表摘要一致、零 drift |
| PostgreSQL 16 | 本机 UAT 通过；远端 CI 待跑 | Docker `postgres:16`，10/10 migration、受控 seed、应用 ready；四角色真实写操作 1/1 |
| 性能与成本 | 仅微基准通过 | 最终复跑 5,000 次 deterministic Provider Adapter，P95 0.439ms、0 错误、0 模型成本；不代表真实端到端 |
| 超时/恢复/并发 | 本地工程通过 | 有界超时、限流、检查点恢复、Action 并发幂等及数据库恢复测试 |
| 自有审计/停用 | 本地工程通过 | Agent/Tool/业务双审计、脱敏、总开关和 Tool 禁用已有测试；真实 SIEM 未接入 |
| HTTPS | 部分通过 | Web 安全头、桌面仅接受 HTTPS；真实域名、证书、反向代理和 TLS 扫描未验证 |
| 企业 IdP | 部分完成/阻断 | credentials 管理员建号、首次改密和会话撤销已验收；公共注册有意关闭，企业 IdP 尚未集成 |
| 真实模型 | 本地 Provider/Harness 基线通过，生产仍待验收 | DeepSeek V4 Flash 非思考模式：90/90 完整、87/90（96.7%）、权限/敏感数据泄露及未确认写入均为 0、P95 3.69s、成本约 $0.005971；仅合成 Tool，不代表数据库/Web/SSE 端到端 |
| 桌面构建 | 未签名 smoke 通过 | Electron 43.4.0；exe/zip 哈希一致、2,706 zip entries、环境文件 0 |
| 桌面签名/升级回滚 | 阻断 | `codeSigned=false`、Authenticode `NotSigned`；没有两个签名版本的升级/回退演练 |
| 干净源码发布 | 阻断 | 当前工作树脏；provenance `sourceDirty=true`；发布脚本会拒绝 |
| 用户验收 | 阻断 | 尚未获得项目负责人对真实环境与最终 Release 的确认 |

只有所有阻断项关闭、证据带有环境/日期/命令/责任人且项目负责人确认后，才允许把 ALG-43、ALG-34 和相关 ALG-23 范围标记完成并执行 Release。
