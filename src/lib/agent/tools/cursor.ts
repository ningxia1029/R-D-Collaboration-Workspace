import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import { toolNameSchema, type ToolName } from "@/lib/agent/tools/contracts";
import { ToolInvocationError } from "@/lib/agent/tools/errors";
import type { CursorPosition } from "@/lib/agent/tools/types";

const cursorPayloadSchema = z
  .object({
    v: z.literal(1),
    tool: toolNameSchema,
    filterHash: z.string().regex(/^[a-f0-9]{64}$/),
    position: z.object({ id: z.string().min(1).max(128) }).strict(),
  })
  .strict();

type CursorPayload = z.infer<typeof cursorPayloadSchema>;

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return String(value);
}

export function filterFingerprint(input: unknown): string {
  const normalized =
    input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => key !== "cursor"))
      : input;
  return createHash("sha256").update(JSON.stringify(canonicalize(normalized))).digest("hex");
}

export class CursorCodec {
  private readonly secret: Buffer;

  constructor(secret: string) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("Tool cursor secret 至少需要 32 字节");
    }
    this.secret = Buffer.from(secret, "utf8");
  }

  encode(tool: ToolName, filterHash: string, position: CursorPosition): string {
    const payload: CursorPayload = { v: 1, tool, filterHash, position };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  decode(cursor: string, tool: ToolName, filterHash: string): CursorPosition {
    const [encoded, suppliedSignature, extra] = cursor.split(".");
    if (!encoded || !suppliedSignature || extra) throw this.invalidCursor();

    const expectedSignature = createHmac("sha256", this.secret).update(encoded).digest();
    let actualSignature: Buffer;
    try {
      actualSignature = Buffer.from(suppliedSignature, "base64url");
    } catch {
      throw this.invalidCursor();
    }
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      throw this.invalidCursor();
    }

    try {
      const payload = cursorPayloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
      if (payload.tool !== tool || payload.filterHash !== filterHash) throw this.invalidCursor();
      return payload.position;
    } catch (error: unknown) {
      if (error instanceof ToolInvocationError) throw error;
      throw this.invalidCursor();
    }
  }

  private invalidCursor(): ToolInvocationError {
    return new ToolInvocationError("validation_error", "cursor 无效、已被篡改或与当前筛选条件不匹配", false, [
      { field: "cursor", code: "invalid_cursor", message: "请从第一页重新查询" },
    ]);
  }
}
