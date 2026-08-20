import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ToolInvocationError } from "@/lib/agent/tools/errors";

const delegationPayloadSchema = z
  .object({
    version: z.literal("1"),
    audience: z.literal("plm-tool-gateway"),
    tokenId: z.string().uuid(),
    runId: z.string().min(1).max(128),
    traceId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(256),
    sessionSubject: z.string().min(1).max(256),
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    locale: z.string().min(2).max(35),
    timezone: z.string().min(1).max(64),
  })
  .strict();

export type AgentDelegationPayload = z.infer<typeof delegationPayloadSchema>;

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "WB-DELEGATION", v: 1 }), "utf8").toString("base64url");
const MAX_DELEGATION_MS = 10 * 60_000;
const MAX_CLOCK_SKEW_MS = 60_000;

function assertSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Agent 委托签名密钥至少需要 32 字节");
  }
}

function signature(secret: string, encoded: string): Buffer {
  return createHmac("sha256", secret).update(encoded).digest();
}

export function issueAgentDelegationToken(
  secret: string,
  input: Omit<AgentDelegationPayload, "version" | "audience" | "tokenId">,
): string {
  assertSecret(secret);
  const payload = delegationPayloadSchema.parse({
    ...input,
    version: "1",
    audience: "plm-tool-gateway",
    tokenId: randomUUID(),
  });
  const issuedAt = new Date(payload.issuedAt).getTime();
  const expiresAt = new Date(payload.expiresAt).getTime();
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_DELEGATION_MS) {
    throw new Error("Agent 委托有效期必须大于 0 且不超过 10 分钟");
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signingInput = `${HEADER}.${encodedPayload}`;
  return `${signingInput}.${signature(secret, signingInput).toString("base64url")}`;
}

export function verifyAgentDelegationToken(
  secret: string,
  token: string,
  options: { now?: Date; expectedRunId?: string } = {},
): AgentDelegationPayload {
  assertSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) {
    throw new ToolInvocationError("auth_required", "Agent 委托凭据格式无效");
  }
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parts[2], "base64url");
  } catch {
    throw new ToolInvocationError("auth_required", "Agent 委托凭据签名无效");
  }
  // Node 会容忍非规范 base64url 尾部位；必须回编码比对，避免同一签名出现可变形 token。
  if (suppliedSignature.toString("base64url") !== parts[2]) {
    throw new ToolInvocationError("auth_required", "Agent 委托凭据签名无效");
  }
  const expectedSignature = signature(secret, `${parts[0]}.${parts[1]}`);
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new ToolInvocationError("auth_required", "Agent 委托凭据签名无效");
  }
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new ToolInvocationError("auth_required", "Agent 委托凭据正文无效");
  }
  const parsed = delegationPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) throw new ToolInvocationError("auth_required", "Agent 委托凭据字段无效");
  const payload = parsed.data;
  const now = (options.now ?? new Date()).getTime();
  const issuedAt = new Date(payload.issuedAt).getTime();
  const expiresAt = new Date(payload.expiresAt).getTime();
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) throw new ToolInvocationError("auth_required", "Agent 委托签发时间无效");
  if (expiresAt <= now) throw new ToolInvocationError("auth_expired", "Agent 委托已过期");
  if (expiresAt - issuedAt > MAX_DELEGATION_MS) throw new ToolInvocationError("auth_required", "Agent 委托有效期超出上限");
  if (options.expectedRunId && payload.runId !== options.expectedRunId) {
    throw new ToolInvocationError("auth_required", "Agent 委托与 Run 不匹配");
  }
  return payload;
}
