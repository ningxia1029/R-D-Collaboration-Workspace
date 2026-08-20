import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/rbac";

const MIN_SECRET_BYTES = 32;
const TOKEN_TTL_MS = 10 * 60_000;

const approvalTokenPayloadSchema = z
  .object({
    v: z.literal(1),
    proposalId: z.string().min(1).max(128),
    userId: z.string().min(1).max(128),
    nonceHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedVersion: z.string().min(1).max(100),
    exp: z.number().int().positive(),
  })
  .strict();

export type ApprovalTokenPayload = z.infer<typeof approvalTokenPayloadSchema>;

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(secret: string, encodedPayload: string): string {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
}

export function actionApprovalSecretReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AGENT_ACTION_APPROVAL_SECRET;
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= MIN_SECRET_BYTES;
}

export function configuredActionApprovalSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (!actionApprovalSecretReady(env)) throw new ApiError(503, "Action Agent 确认密钥尚未配置");
  return env.AGENT_ACTION_APPROVAL_SECRET!;
}

export function issueApprovalToken(
  input: Omit<ApprovalTokenPayload, "v" | "exp"> & { expiresAt: Date },
  secret: string,
  now: Date = new Date(),
): string {
  const exp = Math.min(input.expiresAt.getTime(), now.getTime() + TOKEN_TTL_MS);
  if (exp <= now.getTime()) throw new ApiError(409, "动作提议已过期");
  const payload: ApprovalTokenPayload = {
    v: 1,
    proposalId: input.proposalId,
    userId: input.userId,
    nonceHash: input.nonceHash,
    expectedVersion: input.expectedVersion,
    exp,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signature(secret, encoded)}`;
}

export function verifyApprovalToken(token: string, secret: string, now: Date = new Date()): ApprovalTokenPayload {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) throw new ApiError(400, "确认授权无效或已损坏");
  const expectedSignature = signature(secret, encoded);
  const actual = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError(400, "确认授权无效或已损坏");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "确认授权无效或已损坏");
  }
  const parsed = approvalTokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) throw new ApiError(400, "确认授权无效或已损坏");
  if (parsed.data.exp <= now.getTime()) throw new ApiError(409, "一次性确认授权已过期，请刷新提议");
  return parsed.data;
}
