import { z } from "zod";
import { AgentRuntimeError } from "./errors.js";
import type { ProviderUsage, RuntimeToolResult, ToolDefinition } from "./protocol.js";

const toolCallDecisionSchema = z
  .object({
    kind: z.literal("tool_call"),
    callId: z.string().min(1).max(96),
    toolName: z.string().min(1).max(128),
    input: z.record(z.unknown()),
  })
  .strict();

const answerDecisionSchema = z
  .object({ kind: z.literal("answer"), answer: z.string().min(1).max(40_000) })
  .strict();

const clarifyDecisionSchema = z
  .object({ kind: z.literal("clarify"), question: z.string().min(1).max(2_000) })
  .strict();

const CLARIFICATION_TOOL_NAME = "workbuddy_request_clarification";
const clarificationToolInputSchema = z.object({ question: z.string().min(1).max(2_000) }).strict();

export const providerDecisionSchema = z.discriminatedUnion("kind", [
  toolCallDecisionSchema,
  answerDecisionSchema,
  clarifyDecisionSchema,
]);

export type ProviderDecision = z.infer<typeof providerDecisionSchema>;

export interface ProviderRequest {
  systemPrompt: string;
  promptVersion: string;
  question: string;
  contextProjectId?: string;
  tools: ToolDefinition[];
  toolResults: RuntimeToolResult[];
}

export interface ProviderResponse {
  decision: ProviderDecision;
  usage: ProviderUsage;
  provider: string;
  model: string;
}

export interface ProviderCapabilities {
  structuredToolCalls: boolean;
  usageAccounting: boolean;
  streaming: boolean;
}

export interface ModelProviderAdapter {
  readonly provider: string;
  readonly model: string;
  capabilities(): Promise<ProviderCapabilities>;
  generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}

export class ScriptedProvider implements ModelProviderAdapter {
  readonly provider = "fake";
  readonly model = "deterministic-script-v1";
  private index = 0;

  constructor(private readonly script: ProviderDecision[]) {}

  async capabilities(): Promise<ProviderCapabilities> {
    return { structuredToolCalls: true, usageAccounting: true, streaming: false };
  }

  async generate(_request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const decision = this.script[this.index++];
    if (!decision) throw new AgentRuntimeError("MODEL_INVALID_RESPONSE", "假 Provider 脚本已耗尽");
    return {
      decision: providerDecisionSchema.parse(decision),
      usage: { inputTokens: 16, outputTokens: 8, estimatedCostMicros: 0 },
      provider: this.provider,
      model: this.model,
    };
  }
}

/** 仅用于本地验收的无网络、可重复 Provider；必须由 CLI 的双重环境开关显式启用。 */
export class DeterministicAcceptanceProvider implements ModelProviderAdapter {
  readonly provider = "fake";
  readonly model = "deterministic-acceptance-v1";

  async capabilities(): Promise<ProviderCapabilities> {
    return { structuredToolCalls: true, usageAccounting: true, streaming: false };
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    let decision: ProviderDecision;
    const projectCode = request.question.match(/\b[A-Z]{2,10}-\d+\b/i)?.[0]?.toUpperCase();
    if (/需要补充|消歧/.test(request.question) && !request.question.includes("用户补充：")) {
      decision = { kind: "clarify", question: "请补充具体项目编号或选择项目上下文。" };
    } else if (projectCode && request.toolResults.length === 0) {
      const available = request.tools.some((tool) => tool.name === "plm_project_resolve");
      decision = available
        ? { kind: "tool_call", callId: "acceptance-project-resolve", toolName: "plm_project_resolve", input: { query: projectCode, limit: 5 } }
        : { kind: "answer", answer: "本地验收环境中项目解析 Tool 当前不可用。" };
    } else if (request.toolResults.length > 0) {
      decision = { kind: "answer", answer: "已完成只读项目解析。结论依据、数据截止时间和权限裁剪信息见下方。" };
    } else {
      decision = { kind: "answer", answer: "本地验收回答已完成；该 Provider 不连接外部模型。" };
    }
    return {
      decision,
      usage: { inputTokens: 16, outputTokens: 8, estimatedCostMicros: 0 },
      provider: this.provider,
      model: this.model,
    };
  }
}

interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** DeepSeek V4 首轮只允许显式非思考模式；思考模式需要保存完整 assistant/tool 历史，另行实现。 */
  thinkingMode?: "disabled";
  maxOutputTokens?: number;
  pricing?: {
    cacheHitInputUsdPerMillion: number;
    cacheMissInputUsdPerMillion: number;
    outputUsdPerMillion: number;
  };
  fetchImpl?: typeof fetch;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isOfficialDeepSeekEndpoint(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

export class OpenAICompatibleProvider implements ModelProviderAdapter {
  readonly provider = "openai-compatible";
  readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    if (isOfficialDeepSeekEndpoint(options.baseUrl) && options.thinkingMode !== "disabled") {
      throw new Error("DeepSeek V4 当前必须显式配置 thinkingMode=disabled；思考模式多轮 Tool 协议尚未启用");
    }
    if (options.maxOutputTokens !== undefined && (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0)) {
      throw new Error("maxOutputTokens 必须是正整数");
    }
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = `${stripTrailingSlash(options.baseUrl)}/chat/completions`;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return { structuredToolCalls: true, usageAccounting: true, streaming: false };
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: request.systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          promptVersion: request.promptVersion,
          question: request.question,
          ...(request.contextProjectId
            ? { trustedContext: { contextProjectId: request.contextProjectId } }
            : {}),
        }),
      },
    ];
    for (const result of request.toolResults) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: result.callId,
            type: "function",
            function: { name: result.tool, arguments: JSON.stringify(result.input ?? {}) },
          },
        ],
      });
      messages.push({ role: "tool", tool_call_id: result.callId, content: JSON.stringify(result.output) });
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          ...(this.options.thinkingMode ? { thinking: { type: this.options.thinkingMode } } : {}),
          ...(this.options.maxOutputTokens ? { max_tokens: this.options.maxOutputTokens } : {}),
          messages,
          tools: request.tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          })).concat([
            {
              type: "function",
              function: {
                name: CLARIFICATION_TOOL_NAME,
                description: "当实体型业务请求缺少实际项目编号或名称时，向用户请求必要补充；不会执行任何业务操作。",
                parameters: {
                  type: "object",
                  additionalProperties: false,
                  properties: { question: { type: "string", minLength: 1, maxLength: 2_000 } },
                  required: ["question"],
                },
              },
            },
          ]),
          tool_choice: "auto",
        }),
        signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new AgentRuntimeError("MODEL_UNAVAILABLE", "模型服务当前不可用", true);
    }

    if (response.status === 429) {
      throw new AgentRuntimeError("MODEL_RATE_LIMITED", "模型服务触发限流", true);
    }
    if (!response.ok) {
      throw new AgentRuntimeError("MODEL_UNAVAILABLE", `模型服务返回 HTTP ${response.status}`, response.status >= 500);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
        completion_tokens?: number;
      };
    };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new AgentRuntimeError("MODEL_INVALID_RESPONSE", "模型响应缺少 message");
    const toolCall = message.tool_calls?.[0];
    let candidate: unknown;
    if (toolCall?.function?.name) {
      let input: unknown;
      try {
        input = JSON.parse(toolCall.function.arguments ?? "{}");
      } catch {
        throw new AgentRuntimeError("MODEL_INVALID_RESPONSE", "模型 Tool 参数不是有效 JSON");
      }
      if (toolCall.function.name === CLARIFICATION_TOOL_NAME) {
        const clarification = clarificationToolInputSchema.safeParse(input);
        if (!clarification.success) {
          throw new AgentRuntimeError("MODEL_INVALID_RESPONSE", "模型消歧参数未通过校验");
        }
        candidate = { kind: "clarify", question: clarification.data.question };
      } else {
        candidate = {
          kind: "tool_call",
          callId: toolCall.id ?? `model-call-${Date.now()}`,
          toolName: toolCall.function.name,
          input,
        };
      }
    } else if (message.content?.trim()) {
      const content = message.content.trim();
      let structuredClarification: unknown;
      try {
        const parsedContent = JSON.parse(content) as unknown;
        const parsedDecision = providerDecisionSchema.safeParse(parsedContent);
        structuredClarification = parsedDecision.success && parsedDecision.data.kind === "clarify" ? parsedDecision.data : undefined;
      } catch {
        structuredClarification = undefined;
      }
      candidate = structuredClarification ?? { kind: "answer", answer: content };
    } else {
      throw new AgentRuntimeError("MODEL_INVALID_RESPONSE", "模型既未返回回答也未返回 Tool 调用");
    }

    const parsed = providerDecisionSchema.safeParse(candidate);
    if (!parsed.success) throw new AgentRuntimeError("MODEL_INVALID_RESPONSE", "模型结构化响应未通过校验");
    const inputTokens = Math.max(0, payload.usage?.prompt_tokens ?? 0);
    const outputTokens = Math.max(0, payload.usage?.completion_tokens ?? 0);
    const cacheUsageAvailable =
      payload.usage?.prompt_cache_hit_tokens !== undefined || payload.usage?.prompt_cache_miss_tokens !== undefined;
    const cachedInputTokens = Math.max(0, payload.usage?.prompt_cache_hit_tokens ?? 0);
    const uncachedInputTokens = cacheUsageAvailable
      ? Math.max(0, payload.usage?.prompt_cache_miss_tokens ?? 0)
      : inputTokens;
    const estimatedCostMicros = this.options.pricing
      ? Math.ceil(
          cachedInputTokens * this.options.pricing.cacheHitInputUsdPerMillion +
            uncachedInputTokens * this.options.pricing.cacheMissInputUsdPerMillion +
            outputTokens * this.options.pricing.outputUsdPerMillion,
        )
      : undefined;
    return {
      decision: parsed.data,
      usage: {
        inputTokens,
        outputTokens,
        ...(cacheUsageAvailable ? { cachedInputTokens, uncachedInputTokens } : {}),
        ...(estimatedCostMicros !== undefined ? { estimatedCostMicros } : {}),
      },
      provider: this.provider,
      model: this.model,
    };
  }
}
