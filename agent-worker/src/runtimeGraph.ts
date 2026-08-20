import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { AgentRuntimeError } from "./errors.js";
import { clarificationForProjectResolution, PROJECT_RESOLVE_TOOL_NAME } from "./projectResolutionGuard.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type { ModelProviderAdapter, ProviderResponse } from "./provider.js";
import type {
  PortableRuntimeState,
  RunClaim,
  RuntimeToolClient,
  ToolDefinition,
} from "./protocol.js";

const RuntimeAnnotation = Annotation.Root({
  runtime: Annotation<PortableRuntimeState>({
    reducer: (_current, update) => update,
  }),
});

export interface BoundedCallOptions {
  kind: "model" | "tool";
  timeoutMs: number;
}

export interface RuntimeExecutionGuard {
  checkpoint(): Promise<void>;
  boundedCall<T>(options: BoundedCallOptions, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

interface GraphDependencies {
  claim: RunClaim;
  provider: ModelProviderAdapter;
  toolClient: RuntimeToolClient;
  tools: ToolDefinition[];
  guard: RuntimeExecutionGuard;
}

function bumpEvent(state: PortableRuntimeState, lastNode: string): PortableRuntimeState {
  return { ...state, eventSequence: state.eventSequence + 1, lastNode };
}

function assertStepBudget(state: PortableRuntimeState, claim: RunClaim): void {
  if (state.stepCount >= claim.budget.maxSteps) {
    throw new AgentRuntimeError("STEP_BUDGET_EXCEEDED", `Agent 已达到 ${claim.budget.maxSteps} 步执行上限`);
  }
}

function addUsage(state: PortableRuntimeState, response: ProviderResponse, claim: RunClaim): PortableRuntimeState {
  const inputTokenCount = state.inputTokenCount + response.usage.inputTokens;
  const outputTokenCount = state.outputTokenCount + response.usage.outputTokens;
  if (inputTokenCount > claim.budget.maxInputTokens || outputTokenCount > claim.budget.maxOutputTokens) {
    throw new AgentRuntimeError("TOKEN_BUDGET_EXCEEDED", "模型 token 用量超过 Run 上限");
  }
  return {
    ...state,
    inputTokenCount,
    outputTokenCount,
    estimatedCostMicros: state.estimatedCostMicros + (response.usage.estimatedCostMicros ?? 0),
  };
}

function routeFromPhase(state: { runtime: PortableRuntimeState }): string {
  switch (state.runtime.phase) {
    case "PLAN":
      return "plan";
    case "EXECUTE_TOOL":
      return "tool";
    case "ANSWER":
      return "answer";
    case "WAITING_FOR_USER":
      return "wait";
    case "SUCCEEDED":
      return "done";
  }
}

export function buildRuntimeGraph(dependencies: GraphDependencies) {
  const toolsByName = new Map(dependencies.tools.map((tool) => [tool.name, tool]));

  const resumeNode = async (graphState: typeof RuntimeAnnotation.State) => ({
    runtime: bumpEvent(graphState.runtime, "resume"),
  });

  const planNode = async (graphState: typeof RuntimeAnnotation.State) => {
    await dependencies.guard.checkpoint();
    assertStepBudget(graphState.runtime, dependencies.claim);
    const response = await dependencies.guard.boundedCall(
      { kind: "model", timeoutMs: dependencies.claim.budget.modelTimeoutMs },
      (signal) =>
        dependencies.provider.generate(
          {
            systemPrompt: SYSTEM_PROMPT,
            promptVersion: dependencies.claim.promptVersion,
            question: graphState.runtime.question,
            ...(dependencies.claim.contextProjectId
              ? { contextProjectId: dependencies.claim.contextProjectId }
              : {}),
            tools: dependencies.tools,
            toolResults: graphState.runtime.toolResults,
          },
          signal,
        ),
    );
    let runtime = addUsage(graphState.runtime, response, dependencies.claim);
    runtime = { ...runtime, stepCount: runtime.stepCount + 1, pendingTool: undefined };
    switch (response.decision.kind) {
      case "tool_call":
        runtime = {
          ...runtime,
          phase: "EXECUTE_TOOL",
          pendingTool: {
            callId: response.decision.callId,
            name: response.decision.toolName,
            input: response.decision.input,
            attempt: 0,
          },
        };
        break;
      case "clarify":
        runtime = { ...runtime, phase: "WAITING_FOR_USER", clarification: response.decision.question };
        break;
      case "answer":
        runtime = { ...runtime, phase: "ANSWER", answer: response.decision.answer };
        break;
    }
    await dependencies.guard.checkpoint();
    return { runtime: bumpEvent(runtime, "plan") };
  };

  const toolNode = async (graphState: typeof RuntimeAnnotation.State) => {
    await dependencies.guard.checkpoint();
    const pending = graphState.runtime.pendingTool;
    if (!pending) throw new AgentRuntimeError("INTERNAL_ERROR", "Tool 节点缺少待执行调用");
    const definition = toolsByName.get(pending.name);
    if (!definition || !["none", "proposal"].includes(definition.sideEffect)) {
      throw new AgentRuntimeError("TOOL_NOT_ALLOWED", "模型请求了未授权 Tool");
    }
    if (graphState.runtime.toolCallCount >= dependencies.claim.budget.maxToolCalls) {
      throw new AgentRuntimeError("TOOL_BUDGET_EXCEEDED", `Agent 已达到 ${dependencies.claim.budget.maxToolCalls} 次 Tool 上限`);
    }
    const requestId = `${graphState.runtime.runId}:${pending.callId}:${pending.attempt}`;
    const output = await dependencies.guard.boundedCall(
      {
        kind: "tool",
        timeoutMs: Math.min(definition.timeoutMs, dependencies.claim.budget.toolTimeoutMs),
      },
      (signal) =>
        dependencies.toolClient.invoke({
          delegationToken: dependencies.claim.delegationToken,
          tool: pending.name,
          toolInput: pending.input,
          requestId,
          signal,
        }),
    );
    const bytes = Buffer.byteLength(JSON.stringify(output), "utf8");
    const resultBytes = graphState.runtime.resultBytes + bytes;
    if (resultBytes > dependencies.claim.budget.maxToolResultBytes) {
      throw new AgentRuntimeError("RESULT_BUDGET_EXCEEDED", "Tool 结果累计大小超过 Run 上限");
    }
    const resolutionClarification =
      pending.name === PROJECT_RESOLVE_TOOL_NAME
        ? clarificationForProjectResolution(output)
        : undefined;
    await dependencies.guard.checkpoint();
    return {
      runtime: bumpEvent(
        {
          ...graphState.runtime,
          phase: resolutionClarification ? "WAITING_FOR_USER" : "PLAN",
          pendingTool: undefined,
          toolCallCount: graphState.runtime.toolCallCount + 1,
          resultBytes,
          ...(resolutionClarification ? { clarification: resolutionClarification } : {}),
          toolResults: [
            ...graphState.runtime.toolResults,
            { callId: pending.callId, requestId, tool: pending.name, input: pending.input, output, bytes },
          ],
        },
        "tool",
      ),
    };
  };

  const answerNode = async (graphState: typeof RuntimeAnnotation.State) => ({
    runtime: bumpEvent({ ...graphState.runtime, phase: "SUCCEEDED" }, "answer"),
  });

  const waitNode = async (graphState: typeof RuntimeAnnotation.State) => ({
    runtime: bumpEvent(graphState.runtime, "wait"),
  });

  const doneNode = async (graphState: typeof RuntimeAnnotation.State) => ({
    runtime: graphState.runtime,
  });

  return new StateGraph(RuntimeAnnotation)
    .addNode("resume", resumeNode)
    .addNode("plan", planNode)
    .addNode("tool", toolNode)
    .addNode("answer", answerNode)
    .addNode("wait", waitNode)
    .addNode("done", doneNode)
    .addEdge(START, "resume")
    .addConditionalEdges("resume", routeFromPhase, {
      plan: "plan",
      tool: "tool",
      answer: "answer",
      wait: "wait",
      done: "done",
    })
    .addConditionalEdges("plan", routeFromPhase, {
      tool: "tool",
      answer: "answer",
      wait: "wait",
    })
    .addConditionalEdges("tool", routeFromPhase, {
      plan: "plan",
      wait: "wait",
    })
    .addEdge("answer", END)
    .addEdge("wait", END)
    .addEdge("done", END)
    .compile({ checkpointer: new MemorySaver() });
}
