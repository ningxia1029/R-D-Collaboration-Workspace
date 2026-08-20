import { timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertAgentInternalRequest(request: Request, configuredSecret: string): void {
  if (Buffer.byteLength(configuredSecret, "utf8") < 32) throw new Error("Agent 内部服务密钥至少需要 32 字节");
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!supplied || !safeEqual(supplied, configuredSecret)) {
    const error = new Error("Agent 内部服务认证失败");
    error.name = "AgentInternalAuthError";
    throw error;
  }
}

export function agentInternalErrorResponse(error: unknown): Response {
  const status = error instanceof Error && error.name === "AgentInternalAuthError" ? 401 : 500;
  const code = status === 401 ? "INTERNAL_AUTH_FAILED" : "INTERNAL_ERROR";
  return Response.json({ ok: false, error: { code, message: status === 401 ? "内部服务认证失败" : "内部服务执行失败" } }, { status });
}
