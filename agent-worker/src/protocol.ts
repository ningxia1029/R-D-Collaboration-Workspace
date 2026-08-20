export type RunTerminalStatus = "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED";
export type RunStatus = "QUEUED" | "RUNNING" | "WAITING_FOR_USER" | RunTerminalStatus;

export type RuntimePhase =
  | "PLAN"
  | "EXECUTE_TOOL"
  | "ANSWER"
  | "WAITING_FOR_USER"
  | "SUCCEEDED";

export interface RuntimeBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxToolResultBytes: number;
  maxDurationMs: number;
  modelTimeoutMs: number;
  toolTimeoutMs: number;
}

export const DEFAULT_RUNTIME_BUDGET: Readonly<RuntimeBudget> = Object.freeze({
  maxSteps: 8,
  maxToolCalls: 4,
  maxInputTokens: 12_000,
  maxOutputTokens: 4_000,
  maxToolResultBytes: 256 * 1024,
  maxDurationMs: 120_000,
  modelTimeoutMs: 30_000,
  toolTimeoutMs: 15_000,
});

export interface RunLease {
  runId: string;
  workerId: string;
  version: number;
  expiresAt: string;
}

export interface RunClaim {
  lease: RunLease;
  traceId: string;
  sessionId: string;
  question: string;
  contextProjectId?: string;
  delegationToken: string;
  locale: string;
  timezone: string;
  promptVersion: string;
  budget: RuntimeBudget;
  createdAt: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sideEffect: "none" | "proposal";
  timeoutMs: number;
}

export interface PendingToolCall {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  attempt: number;
}

export interface RuntimeToolResult {
  callId: string;
  requestId: string;
  tool: string;
  input?: Record<string, unknown>;
  output: unknown;
  bytes: number;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  uncachedInputTokens?: number;
  estimatedCostMicros?: number;
}

export interface PortableRuntimeState {
  schemaVersion: "1.0";
  runId: string;
  traceId: string;
  question: string;
  phase: RuntimePhase;
  stepCount: number;
  toolCallCount: number;
  inputTokenCount: number;
  outputTokenCount: number;
  estimatedCostMicros: number;
  resultBytes: number;
  eventSequence: number;
  pendingTool?: PendingToolCall;
  toolResults: RuntimeToolResult[];
  answer?: string;
  clarification?: string;
  lastNode: string;
}

export interface PersistedCheckpoint {
  checkpointId: string;
  parentCheckpointId?: string;
  state: PortableRuntimeState;
  createdAt: string;
}

export interface RunTransition {
  status: Exclude<RunStatus, "QUEUED" | "RUNNING">;
  currentNode: string;
  failureCode?: string;
  failureMessage?: string;
  answer?: string;
  usage: ProviderUsage & {
    stepCount: number;
    toolCallCount: number;
    resultBytes: number;
  };
}

export interface RuntimeControlPlane {
  claimNext(workerId: string, leaseMs: number): Promise<RunClaim | null>;
  loadLatestCheckpoint(lease: RunLease): Promise<PersistedCheckpoint | null>;
  heartbeat(lease: RunLease, leaseMs: number): Promise<RunLease>;
  isCancellationRequested(lease: RunLease): Promise<boolean>;
  saveCheckpoint(
    lease: RunLease,
    checkpoint: Omit<PersistedCheckpoint, "createdAt">,
  ): Promise<void>;
  appendEvent(
    lease: RunLease,
    event: { sequence: number; eventType: string; payload: Record<string, unknown> },
  ): Promise<void>;
  transition(lease: RunLease, transition: RunTransition): Promise<void>;
}

export interface RuntimeToolClient {
  listTools(delegationToken: string, signal?: AbortSignal): Promise<ToolDefinition[]>;
  invoke(input: {
    delegationToken: string;
    tool: string;
    toolInput: Record<string, unknown>;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export function createInitialState(claim: RunClaim): PortableRuntimeState {
  return {
    schemaVersion: "1.0",
    runId: claim.lease.runId,
    traceId: claim.traceId,
    question: claim.question,
    phase: "PLAN",
    stepCount: 0,
    toolCallCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    estimatedCostMicros: 0,
    resultBytes: 0,
    eventSequence: 0,
    toolResults: [],
    lastNode: "start",
  };
}
