export type RuntimeErrorCode =
  | "RUN_CANCELLED"
  | "RUN_TIMEOUT"
  | "STEP_BUDGET_EXCEEDED"
  | "TOOL_BUDGET_EXCEEDED"
  | "TOKEN_BUDGET_EXCEEDED"
  | "RESULT_BUDGET_EXCEEDED"
  | "MODEL_TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "MODEL_RATE_LIMITED"
  | "MODEL_INVALID_RESPONSE"
  | "TOOL_TIMEOUT"
  | "TOOL_NOT_ALLOWED"
  | "CONTROL_PLANE_CONFLICT"
  | "INTERNAL_ERROR";

export class AgentRuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

/** 测试与进程监管器用于模拟突然退出；不得转换为业务终态。 */
export class WorkerProcessInterrupted extends Error {
  constructor(message = "Agent Worker 进程被中断") {
    super(message);
    this.name = "WorkerProcessInterrupted";
  }
}

export function normalizeRuntimeError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new AgentRuntimeError("RUN_TIMEOUT", "Agent Run 已超过执行时限");
  }
  return new AgentRuntimeError("INTERNAL_ERROR", "Agent Runtime 发生未分类错误");
}
