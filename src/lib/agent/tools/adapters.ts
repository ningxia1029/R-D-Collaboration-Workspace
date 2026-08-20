import type { ToolExecutionContext, ToolName } from "@/lib/agent/tools/contracts";
import type { ModelToolDefinition, ToolGateway } from "@/lib/agent/tools/gateway";

export class InternalToolAdapter {
  constructor(private readonly gateway: ToolGateway) {}

  listTools(): ModelToolDefinition[] {
    return this.gateway.listModelTools();
  }

  invoke(tool: ToolName, input: unknown, context: ToolExecutionContext): Promise<unknown> {
    return this.gateway.invoke(tool, input, context);
  }
}

export interface McpToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

export class McpToolAdapter {
  constructor(private readonly gateway: ToolGateway) {}

  listTools(): McpToolDefinition[] {
    return this.gateway.listModelTools().map((tool) => ({
      name: tool.name,
      title: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: {
        readOnlyHint: tool.sideEffect === "none",
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }));
  }

  callTool(tool: ToolName, input: unknown, context: ToolExecutionContext): Promise<unknown> {
    return this.gateway.invoke(tool, input, context);
  }
}
