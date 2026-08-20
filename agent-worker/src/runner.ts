import { createHash } from "node:crypto";
import { AgentRuntimeError, normalizeRuntimeError, WorkerProcessInterrupted } from "./errors.js";
import type { ModelProviderAdapter } from "./provider.js";
import { buildRuntimeGraph, type BoundedCallOptions, type RuntimeExecutionGuard } from "./runtimeGraph.js";
import {
  createInitialState,
  type PersistedCheckpoint,
  type PortableRuntimeState,
  type RunClaim,
  type RunLease,
  type RuntimeControlPlane,
  type RuntimeToolClient,
} from "./protocol.js";

export interface AgentRunnerHooks {
  afterCheckpoint?(checkpoint: PersistedCheckpoint): Promise<void> | void;
}

export interface AgentRunnerOptions {
  workerId: string;
  leaseMs?: number;
  pollCancellationMs?: number;
  clock?: () => number;
  hooks?: AgentRunnerHooks;
}

export interface RunExecutionResult {
  runId: string;
  status: "SUCCEEDED" | "WAITING_FOR_USER" | "FAILED" | "CANCELLED" | "EXPIRED";
  state?: PortableRuntimeState;
  errorCode?: string;
}

function checkpointId(state: PortableRuntimeState): string {
  const digest = createHash("sha256")
    .update(`${state.runId}|${state.eventSequence}|${state.lastNode}|${state.stepCount}|${state.toolCallCount}`)
    .digest("hex")
    .slice(0, 16);
  return `runtime-${String(state.eventSequence).padStart(4, "0")}-${digest}`;
}

class ControlPlaneGuard implements RuntimeExecutionGuard {
  private lease: RunLease;
  private readonly deadline: number;
  private readonly clock: () => number;
  private readonly pollMs: number;

  constructor(
    private readonly controlPlane: RuntimeControlPlane,
    private readonly claim: RunClaim,
    private readonly leaseMs: number,
    pollCancellationMs: number,
    clock: () => number,
  ) {
    this.lease = claim.lease;
    this.deadline = clock() + claim.budget.maxDurationMs;
    this.clock = clock;
    this.pollMs = Math.max(25, pollCancellationMs);
  }

  currentLease(): RunLease {
    return this.lease;
  }

  async checkpoint(): Promise<void> {
    if (this.clock() >= this.deadline) throw new AgentRuntimeError("RUN_TIMEOUT", "Agent Run 已超过执行时限");
    if (await this.controlPlane.isCancellationRequested(this.lease)) {
      throw new AgentRuntimeError("RUN_CANCELLED", "用户已取消 Agent Run");
    }
    this.lease = await this.controlPlane.heartbeat(this.lease, this.leaseMs);
  }

  async boundedCall<T>(
    options: BoundedCallOptions,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    await this.checkpoint();
    const controller = new AbortController();
    const remaining = this.deadline - this.clock();
    if (remaining <= 0) throw new AgentRuntimeError("RUN_TIMEOUT", "Agent Run 已超过执行时限");
    const effectiveTimeout = Math.max(1, Math.min(options.timeoutMs, remaining));
    let cancelled = false;
    let overallExpired = false;
    let pollActive = true;
    let rejectCancellation: ((error: unknown) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const poll = setInterval(async () => {
      if (!pollActive) return;
      pollActive = false;
      try {
        overallExpired = this.clock() >= this.deadline;
        cancelled = await this.controlPlane.isCancellationRequested(this.lease);
        if (cancelled || overallExpired) {
          controller.abort();
          rejectCancellation?.(
            new AgentRuntimeError(
              cancelled ? "RUN_CANCELLED" : "RUN_TIMEOUT",
              cancelled ? "用户已取消 Agent Run" : "Agent Run 已超过执行时限",
            ),
          );
        }
      } catch (error: unknown) {
        controller.abort();
        rejectCancellation?.(error);
      } finally {
        pollActive = true;
      }
    }, this.pollMs);
    const timeout = setTimeout(() => {
      controller.abort();
      rejectCancellation?.(
        new AgentRuntimeError(
          options.kind === "model" ? "MODEL_TIMEOUT" : "TOOL_TIMEOUT",
          options.kind === "model" ? "模型调用超时" : "Tool 调用超时",
          true,
        ),
      );
    }, effectiveTimeout);

    try {
      return await Promise.race([operation(controller.signal), cancellation]);
    } finally {
      clearInterval(poll);
      clearTimeout(timeout);
      await this.checkpoint();
    }
  }
}

export class AgentRunner {
  private readonly leaseMs: number;
  private readonly pollCancellationMs: number;
  private readonly clock: () => number;

  constructor(
    private readonly controlPlane: RuntimeControlPlane,
    private readonly toolClient: RuntimeToolClient,
    private readonly provider: ModelProviderAdapter,
    private readonly options: AgentRunnerOptions,
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.pollCancellationMs = options.pollCancellationMs ?? 250;
    this.clock = options.clock ?? Date.now;
  }

  claimNext(): Promise<RunClaim | null> {
    return this.controlPlane.claimNext(this.options.workerId, this.leaseMs);
  }

  async execute(claim: RunClaim): Promise<RunExecutionResult> {
    const guard = new ControlPlaneGuard(
      this.controlPlane,
      claim,
      this.leaseMs,
      this.pollCancellationMs,
      this.clock,
    );
    let state: PortableRuntimeState | undefined;
    let parentCheckpointId: string | undefined;
    try {
      const capabilities = await this.provider.capabilities();
      if (!capabilities.structuredToolCalls) {
        throw new AgentRuntimeError("MODEL_UNAVAILABLE", "当前 Provider 不支持结构化 Tool 调用");
      }
      const restored = await this.controlPlane.loadLatestCheckpoint(guard.currentLease());
      state = restored?.state ?? createInitialState(claim);
      parentCheckpointId = restored?.checkpointId;
      const tools = await guard.boundedCall(
        { kind: "tool", timeoutMs: claim.budget.toolTimeoutMs },
        (signal) => this.toolClient.listTools(claim.delegationToken, signal),
      );
      const graph = buildRuntimeGraph({ claim, provider: this.provider, toolClient: this.toolClient, tools, guard });
      const stream = await graph.stream(
        { runtime: state },
        { configurable: { thread_id: `${claim.lease.runId}:${claim.lease.version}` }, streamMode: "values" },
      );
      for await (const value of stream) {
        state = value.runtime;
        const id = checkpointId(state);
        const checkpoint: PersistedCheckpoint = {
          checkpointId: id,
          ...(parentCheckpointId ? { parentCheckpointId } : {}),
          state,
          createdAt: new Date(this.clock()).toISOString(),
        };
        const activeLease = guard.currentLease();
        await this.controlPlane.saveCheckpoint(activeLease, {
          checkpointId: id,
          ...(parentCheckpointId ? { parentCheckpointId } : {}),
          state,
        });
        await this.controlPlane.appendEvent(activeLease, {
          sequence: state.eventSequence,
          eventType: "RUNTIME_CHECKPOINT",
          payload: {
            checkpointId: id,
            node: state.lastNode,
            phase: state.phase,
            stepCount: state.stepCount,
            toolCallCount: state.toolCallCount,
          },
        });
        parentCheckpointId = id;
        await this.options.hooks?.afterCheckpoint?.(checkpoint);
      }
      if (!state) throw new AgentRuntimeError("INTERNAL_ERROR", "状态图未产生运行状态");
      const terminalStatus = state.phase === "WAITING_FOR_USER" ? "WAITING_FOR_USER" : "SUCCEEDED";
      await this.controlPlane.transition(guard.currentLease(), {
        status: terminalStatus,
        currentNode: state.lastNode,
        answer: terminalStatus === "SUCCEEDED" ? state.answer : state.clarification,
        usage: {
          inputTokens: state.inputTokenCount,
          outputTokens: state.outputTokenCount,
          estimatedCostMicros: state.estimatedCostMicros,
          stepCount: state.stepCount,
          toolCallCount: state.toolCallCount,
          resultBytes: state.resultBytes,
        },
      });
      return { runId: claim.lease.runId, status: terminalStatus, state };
    } catch (error: unknown) {
      if (error instanceof WorkerProcessInterrupted) throw error;
      const normalized = normalizeRuntimeError(error);
      const status = normalized.code === "RUN_CANCELLED" ? "CANCELLED" : normalized.code === "RUN_TIMEOUT" ? "EXPIRED" : "FAILED";
      const fallback = state ?? createInitialState(claim);
      await this.controlPlane.transition(guard.currentLease(), {
        status,
        currentNode: fallback.lastNode,
        failureCode: normalized.code,
        failureMessage: normalized.message,
        usage: {
          inputTokens: fallback.inputTokenCount,
          outputTokens: fallback.outputTokenCount,
          estimatedCostMicros: fallback.estimatedCostMicros,
          stepCount: fallback.stepCount,
          toolCallCount: fallback.toolCallCount,
          resultBytes: fallback.resultBytes,
        },
      });
      return { runId: claim.lease.runId, status, state: fallback, errorCode: normalized.code };
    }
  }
}
