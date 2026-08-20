import { randomUUID } from "node:crypto";
import { HttpRuntimeControlPlane, HttpRuntimeToolClient } from "./httpClients.js";
import { DeterministicAcceptanceProvider, OpenAICompatibleProvider, type ModelProviderAdapter } from "./provider.js";
import { AgentRunner } from "./runner.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少必需的 Agent Worker 配置：${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}

function createProvider(): ModelProviderAdapter {
  const kind = process.env.AGENT_MODEL_PROVIDER ?? "openai-compatible";
  if (kind === "fake" && process.env.AGENT_ALLOW_FAKE_PROVIDER === "1") {
    return new DeterministicAcceptanceProvider();
  }
  if (kind !== "openai-compatible") throw new Error(`不支持的 AGENT_MODEL_PROVIDER：${kind}`);
  const baseUrl = required("AGENT_MODEL_BASE_URL");
  const model = required("AGENT_MODEL_NAME");
  const thinking = process.env.AGENT_MODEL_THINKING;
  if (thinking && thinking !== "disabled") {
    throw new Error("AGENT_MODEL_THINKING 当前只允许 disabled；思考模式 Tool 历史协议尚未启用");
  }
  const thinkingMode: "disabled" | undefined = thinking === "disabled" ? "disabled" : undefined;
  const isDeepSeekFlash = new URL(baseUrl).hostname.toLowerCase() === "api.deepseek.com" && model === "deepseek-v4-flash";
  return new OpenAICompatibleProvider({
    baseUrl,
    apiKey: required("AGENT_MODEL_API_KEY"),
    model,
    ...(thinkingMode ? { thinkingMode } : {}),
    maxOutputTokens: positiveInteger("AGENT_MODEL_MAX_OUTPUT_TOKENS", 2_048),
    ...(isDeepSeekFlash
      ? {
          pricing: {
            cacheHitInputUsdPerMillion: 0.0028,
            cacheMissInputUsdPerMillion: 0.14,
            outputUsdPerMillion: 0.28,
          },
        }
      : {}),
  });
}

const baseUrl = required("AGENT_RUNTIME_BASE_URL");
const serviceCredential = required("AGENT_INTERNAL_SERVICE_SECRET");
const workerId = process.env.AGENT_WORKER_ID ?? `worker-${randomUUID()}`;
const httpOptions = { baseUrl, serviceCredential };
const runner = new AgentRunner(
  new HttpRuntimeControlPlane(httpOptions),
  new HttpRuntimeToolClient(httpOptions),
  createProvider(),
  { workerId },
);

let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});

console.log(`[agent-worker] started workerId=${workerId}`);
while (!stopping) {
  const claim = await runner.claimNext();
  if (!claim) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    continue;
  }
  const result = await runner.execute(claim);
  console.log(`[agent-worker] run=${result.runId} status=${result.status}${result.errorCode ? ` error=${result.errorCode}` : ""}`);
}
console.log(`[agent-worker] stopped workerId=${workerId}`);
