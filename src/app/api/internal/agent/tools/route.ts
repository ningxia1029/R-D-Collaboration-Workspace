import { z } from "zod";
import { getAgentControlSnapshot } from "@/lib/agent/control";
import { agentInternalErrorResponse, assertAgentInternalRequest } from "@/lib/agent/internalAuth";
import { toolNameSchema } from "@/lib/agent/tools/contracts";
import { ToolInvocationError } from "@/lib/agent/tools/errors";
import { DelegatedToolGateway } from "@/lib/agent/tools/delegated";
import { createProductionToolGateway } from "@/lib/agent/tools/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), delegationToken: z.string().min(1).max(4_096) }).strict(),
  z
    .object({
      action: z.literal("invoke"),
      delegationToken: z.string().min(1).max(4_096),
      tool: z.string().min(1).max(128),
      toolInput: z.record(z.unknown()),
      requestId: z.string().min(1).max(128),
    })
    .strict(),
]);

function configured(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少内部 Agent 配置：${name}`);
  return value;
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertAgentInternalRequest(request, configured("AGENT_INTERNAL_SERVICE_SECRET"));
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 512 * 1024) {
      return Response.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Tool 请求正文过大" } }, { status: 413 });
    }
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Tool 请求不符合契约" } }, { status: 400 });
    }
    const gateway = new DelegatedToolGateway(
      createProductionToolGateway({ cursorSecret: configured("AGENT_CURSOR_SECRET") }),
      configured("AGENT_DELEGATION_SECRET"),
    );
    const control = await getAgentControlSnapshot();
    if (!control.operational) {
      throw new ToolInvocationError("tool_disabled", control.maintenanceMessage ?? "企业智能体当前未启用");
    }
    const input = parsed.data;
    let data: unknown;
    if (input.action === "list") {
      data = gateway
        .listModelTools(input.delegationToken)
        .filter((tool) => !control.disabledTools.includes(tool.name));
    } else {
      const parsedTool = toolNameSchema.safeParse(input.tool);
      if (parsedTool.success && control.disabledTools.includes(parsedTool.data)) {
        throw new ToolInvocationError("tool_disabled", "该 Tool 已被管理员停用");
      }
      data = await gateway.invoke({
            delegationToken: input.delegationToken,
            tool: input.tool,
            toolInput: input.toolInput,
            requestId: input.requestId,
          });
    }
    return Response.json({ ok: true, data });
  } catch (error: unknown) {
    if (error instanceof ToolInvocationError) {
      const status = error.code === "auth_required" || error.code === "auth_expired" ? 401 : 400;
      return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status });
    }
    return agentInternalErrorResponse(error);
  }
}
