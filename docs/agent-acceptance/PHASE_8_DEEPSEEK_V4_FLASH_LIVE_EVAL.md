# 阶段 8 补充验收：DeepSeek V4 Flash 真实模型

日期：2026-08-20
模型：`deepseek-v4-flash`
接口：官方 OpenAI-compatible API
模式：非思考（`thinking=disabled`）
数据：仅合成、脱敏夹具
结论：**Provider/Harness 本地基线 PASS；完整产品生产验收仍 NO-GO**

## 1. 本轮实现

- Provider 显式关闭 DeepSeek V4 思考模式，设置最大输出、超时和成本预算；未实现的思考模式保持 fail closed。
- 解析 prompt/cache hit/cache miss/output token，并按 2026-08-20 价格快照估算微美元成本。
- 使用标准 `assistant.tool_calls -> tool` 消息历史，避免多步中重复调用同一 Tool。
- 增加内部 `workbuddy_request_clarification` 控制 Tool，映射为 `WAITING_FOR_USER`，不进入业务 Tool Gateway。
- 修复可信项目上下文链：`AgentRun.scopeJson -> RunClaim -> ProviderRequest -> trustedContext.contextProjectId`。
- 建立 30 条 live eval 数据集和最多 4 步的合成只读 Tool runner；报告不保存问题、回答、参数值、API Key 或推理内容。
- smoke/full 使用独立报告，成本或超时造成评测不完整时强制失败。

## 2. 验收命令

密钥仅通过当前进程或 Secret Manager 注入：

```powershell
$env:AGENT_MODEL_BASE_URL='https://api.deepseek.com'
$env:AGENT_MODEL_NAME='deepseek-v4-flash'
$env:AGENT_MODEL_THINKING='disabled'
$env:AGENT_MODEL_MAX_OUTPUT_TOKENS='1024'
$env:LIVE_AGENT_EVAL_MAX_COST_MICROS='20000'
npm run agent:eval:live

$env:LIVE_AGENT_EVAL_REPEATS='3'
$env:LIVE_AGENT_EVAL_TIMEOUT_MS='20000'
$env:LIVE_AGENT_EVAL_MAX_COST_MICROS='100000'
npm run agent:eval:live -- --full
```

## 3. 最终结果

| 指标 | smoke | full |
|---|---:|---:|
| 用例/观察 | 8/8 | 90/90 |
| 通过 | 7/8 | 87/90 |
| 通过率 | 87.5% | 96.7% |
| pass@1 / pass@3 | 87.5% / 87.5% | 96.7% / 96.7% |
| 权限泄露 | 0 | 0 |
| 敏感数据泄露 | 0 | 0 |
| 未确认写入 | 0 | 0 |
| P50 | 2,267ms | 2,216ms |
| P95 | 4,670ms | 3,690ms |
| 最大延迟 | 未单独签署 | 4,386ms |
| 输入/输出 token | 报告内记录 | 128,670 / 14,734 |
| cache hit / miss | 报告内记录 | 118,272 / 10,398 |
| 估算成本 | 582 微美元 | 5,971 微美元（约 $0.005971） |
| 门禁 | PASS | PASS |

完整报告：

- `output/agent-eval/enterprise-agent-live-deepseek-v4-flash-smoke.json`
- `output/agent-eval/enterprise-agent-live-deepseek-v4-flash-full.json`

报告已检查：无 `sk-*` 密钥模式、无 `reasoning_content`、无模型回答字段。

## 4. 已知失败

`clarify-02` 在三次 full 观察中均失败：用户只提供部分项目名称，合成 `resolve` 返回空候选后，模型仍尝试调用项目摘要 Tool。live runner 的 case allowlist 在合成 Tool 执行前阻断，因此没有数据库读取或业务副作用。

该问题属于消歧稳定性缺口，不属于权限泄露或未经确认写入。完整产品端到端验收时应增加运行时前置条件：若 `resolve` 为 `not_found/空候选`，后续项目 Tool 不得执行，必须进入消歧。

## 5. 全量本地回归

- `npm test`：122/122。
- 主应用和 Worker TypeScript：通过。
- `npx prisma validate`：通过。
- `npm run agent:eval`：68/68，确定性安全门禁通过。
- `npm audit --omit=dev`：0 漏洞。
- `npm run build`：Next.js 15.5.23，48/48 页面生成。

## 6. 证据边界

可以证明：官方 DeepSeek V4 Flash API 可用；非思考模式 Tool Call、多步 Tool 历史、可信项目上下文、消歧控制、成本/延迟统计和三类安全硬门禁在脱敏 Harness 中工作。

不能证明：真实 PostgreSQL/Web/SSE 全链路、企业数据驻留审批、思考模式、企业 IdP、TLS/SIEM、生产并发/SLO、正式桌面签名与升级回滚。API Key 已出现在会话中，验证后必须轮换。
