import { verifyAgentDelegationToken } from "@/lib/agent/delegation";
import { toolNameSchema } from "@/lib/agent/tools/contracts";
import { ToolInvocationError } from "@/lib/agent/tools/errors";
import type { ModelToolDefinition, ToolGateway } from "@/lib/agent/tools/gateway";

export class DelegatedToolGateway {
  constructor(
    private readonly gateway: ToolGateway,
    private readonly delegationSecret: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  listModelTools(delegationToken: string): ModelToolDefinition[] {
    verifyAgentDelegationToken(this.delegationSecret, delegationToken, { now: this.clock() });
    return this.gateway.listModelTools();
  }

  invoke(input: {
    delegationToken: string;
    tool: unknown;
    toolInput: unknown;
    requestId: string;
  }): Promise<unknown> {
    const payload = verifyAgentDelegationToken(this.delegationSecret, input.delegationToken, { now: this.clock() });
    const parsedTool = toolNameSchema.safeParse(input.tool);
    if (!parsedTool.success) throw new ToolInvocationError("tool_disabled", "Tool 未注册或未启用");
    if (!input.requestId || input.requestId.length > 128 || !input.requestId.startsWith(`${payload.runId}:`)) {
      throw new ToolInvocationError("validation_error", "Tool requestId 与委托 Run 不匹配");
    }
    return this.gateway.invoke(parsedTool.data, input.toolInput, {
      runId: payload.runId,
      traceId: payload.traceId,
      requestId: input.requestId,
      sessionSubject: payload.sessionSubject,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      locale: payload.locale,
      timezone: payload.timezone,
    });
  }
}
