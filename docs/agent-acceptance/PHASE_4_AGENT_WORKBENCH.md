# 阶段 4：工作台 UI 与会话体验验收记录

| 属性 | 结果 |
|---|---|
| 日期 | 2026-08-13 |
| 状态 | **Codex 验收通过** |
| 范围 | Agent 工作台、会话 API/SSE、消歧恢复、证据呈现、取消/重试、管理员控制台、响应式与基础可访问性 |
| 数据库 | 两个可丢弃 WSL PostgreSQL 14.23 实例；最终回归为 `127.0.0.1:55434/workbuddy_phase4_final` |
| 浏览器 | Playwright CLI 驱动真实 Chromium；管理员与研发工程师演示身份 |
| 清理 | Web/Worker/浏览器会话均关闭，`.playwright-cli` 与临时日志删除，`PHASE4_CLEANUP_OK` |

## 1. 已实现

- `/agent` 工作台、主导航和项目页“问智能体”入口；项目上下文通过 URL 传递并由服务端重新鉴权。
- 用户只能列出和读取自己的 Run；非本人统一返回 404。非管理员读取历史结果时再次校验上下文及证据项目成员关系，权限撤销后 fail closed。
- 原子创建 Run/首条消息/初始事件，支持用户幂等键、15 分钟运行期限、30 天保留期限和敏感输入标记。
- SSE 事件流、页面刷新恢复、同 Run 消歧补充、确定性取消与新 Run 安全重试；等待态恢复后会重建事件连接。
- 前台 Presenter 只输出白名单化 `evidence/asOf/scope/warnings/error`，不向浏览器下发原始检查点和 Tool `data`。
- 管理员控制台支持默认关闭的总开关、维护提示、Tool 停用清单、Run 状态、Worker 最近心跳、脱敏失败摘要；控制动作写业务审计。
- 总开关关闭后立即取消 `QUEUED/WAITING_FOR_USER`，对 `RUNNING` 设置取消请求，内部 Runtime 停止领取，Tool Gateway fail closed。
- 桌面/窄屏响应式导航、原生控件/ARIA 名称、`aria-live`、可见焦点和至少 24px 交互目标。

## 2. 自动化门禁

```powershell
node --version
npm run typecheck
npm test
npm run build
git diff --check
```

- Node `v24.12.0`。
- TypeScript 通过；Node test runner `50/50` 通过。
- Next.js 生产构建通过，42/42 页面生成；`/agent`、`/admin/agent`、7 个用户 Agent API 和 2 个内部 API 均进入构建产物。
- `git diff --check` 无空白错误；仅提示现有工作树的 CRLF 转换警告。

## 3. 隔离 PostgreSQL 验收

```powershell
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55434/workbuddy_phase4_final?schema=public'
npx prisma migrate deploy
$env:AGENT_UI_VERIFY_TARGET_ACK='workbuddy_phase4_final'
$env:AGENT_UI_VERIFY_ALLOW_DESTRUCTIVE='1'
npm run db:agent-ui-verify
npx prisma migrate status
```

- 6/6 migrations 成功应用，schema 为最新状态。
- 无控制行默认关闭；密钥任一缺失/不足 32 字节均不可运行；管理员显式启用后才可领取。
- 相同用户幂等键只产生一个 Run；消息和初始事件原子写入。
- 所有权隔离、排队取消、消歧检查点父链、同会话新 Run 重试均通过。
- Presenter 不泄露原始 Tool `data`；证据、数据截止时间、权限和裁剪可见。
- 项目成员关系撤销后，用户自己的旧 Run 也不可继续读取。
- 总开关取消排队 Run、写终态事件、请求运行中 Run 取消，并为启用/停用各写一条控制审计。
- 最终实例已停止并删除：`PHASE4_CLEANUP_OK`。

## 4. 真实浏览器验收

通过 Playwright CLI 逐步快照和交互验证：

- 管理员登录、总开关启用、状态变为“服务可用”，控制动作写审计。
- 固定本地 Provider 完成 `TH-100` 项目解析，真实只读 Tool 返回项目证据；回答页显示实体深链和 `asOf`，深链由 `/projects/:id` 正确重定向到任务页。
- 消歧问题进入 `WAITING_FOR_USER`；补充项目编号后同一 Run 从父检查点恢复，不刷新页面即收到 `SUCCEEDED` 事件和新证据。
- Worker 停止时创建排队 Run，用户点击取消后立即进入 `CANCELLED`；安全重试保留原取消记录并创建新 Run。
- 管理员停用总开关时出现明确影响确认；排队 Run 被取消，工程师页面显示维护提示且“安全运行”禁用，主 PLM 页面仍可访问。
- 研发工程师导航不含系统管理；直接访问 `/admin/agent` 被客户端重定向到 `/dashboard`，服务端 API 仍由 `admin:audit_read` 强制授权。
- 390×844 视口中表单、会话、详情按单列真实滚动，主导航变为有可访问名称的 Drawer。
- 修复 Ant Design Form 脱离和 `Card.bodyStyle` 弃用警告、补充 favicon 后，干净会话控制台为 **0 errors / 0 warnings**。

## 5. 能证明与不能证明

可以证明：WorkBuddy Web 中的会话闭环、确定性状态、SSE 恢复、项目权限重验、白名单证据、用户取消、安全重试、管理员停用、窄屏布局和基础键盘/语义契约符合阶段 4 标准。

不能证明：浏览器端到端使用的是明确双重开关保护的 deterministic fake Provider，不是外部真实模型；未验证企业 SSO/IdP、真实数据驻留、人工屏幕阅读器、桌面安装包重启或生产反向代理对 SSE 的行为；这些分别属于部署策略或阶段 8 门禁。
