# Agent 模型切换手册

## 1. 变更输入

记录 Provider、模型名、API/数据区域、保留策略、上下文限制、结构化 Tool 支持、token 计费与批准人。模型密钥只使用 Secret 管理。

## 2. 预生产步骤

1. 固定代码、prompt、Tool contract 和评测集版本。
2. 运行 `npm run agent:eval`；确定性安全 judge 必须保持全通过。
3. 用脱敏代表性问题运行真实模型评测，记录回答准确率、引用支持率、P50/P95、超时、429、token 与成本。
4. 验证未知 Tool、身份字段注入、文档提示注入和直接执行请求均 fail closed。
5. 在独立 Worker 小流量运行，不同时修改 prompt、模型和 Tool 契约。

## 3. 切换配置

```text
AGENT_MODEL_PROVIDER=openai-compatible
AGENT_MODEL_BASE_URL=https://...
AGENT_MODEL_NAME=...
AGENT_MODEL_API_KEY=<secret>
AGENT_MODEL_THINKING=disabled
AGENT_MODEL_MAX_OUTPUT_TOKENS=2048
```

DeepSeek V4 首轮只允许 `disabled`：当前非思考模式已经验证标准 `assistant.tool_calls → tool` 多步历史；思考模式还需要完整保留 `reasoning_content`，不得仅改环境变量强行开启。密钥不要粘贴到文档、日志、Notion 或 Git；临时验收密钥使用后立即轮换。

### DeepSeek V4 Flash 预验收

```powershell
$env:AGENT_MODEL_BASE_URL='https://api.deepseek.com'
$env:AGENT_MODEL_NAME='deepseek-v4-flash'
$env:AGENT_MODEL_THINKING='disabled'
$env:AGENT_MODEL_MAX_OUTPUT_TOKENS='1024'
$env:LIVE_AGENT_EVAL_MAX_COST_MICROS='20000'
npm run agent:eval:live

$env:LIVE_AGENT_EVAL_REPEATS='3'
$env:LIVE_AGENT_EVAL_MAX_COST_MICROS='100000'
npm run agent:eval:live -- --full
```

smoke 与 full 分别生成独立报告。硬门禁为：评测完整率 100%、总体通过率不低于 90%、权限泄露 0、敏感数据泄露 0、未确认写入 0。模型输入只能使用合成或经批准的脱敏数据。

先停止领取，再替换 Worker；旧 Worker 完全退出后启动新 Worker。Web/API 不需要获得模型密钥。

## 4. 回滚

错误率、P95、引用支持率、权限或成本超过批准阈值时立即停止新 Worker，恢复上一组 Secret/模型名并重启旧版本 Worker。未完成真实模型评测前，不把本地 deterministic Provider 的 0 成本或延迟作为生产结论。
