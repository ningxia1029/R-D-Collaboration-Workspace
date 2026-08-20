import type { ToolErrorCode } from "@/lib/agent/tools/contracts";

export interface ToolErrorDetail {
  field?: string;
  code: string;
  message: string;
}

export class ToolInvocationError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly details?: ToolErrorDetail[],
  ) {
    super(message);
    this.name = "ToolInvocationError";
  }
}
