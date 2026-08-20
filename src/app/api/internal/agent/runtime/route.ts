import { z } from "zod";
import { agentInternalErrorResponse, assertAgentInternalRequest } from "@/lib/agent/internalAuth";
import { getAgentControlSnapshot } from "@/lib/agent/control";
import {
  PrismaAgentRuntimeControlPlane,
  RuntimeLeaseConflictError,
} from "@/lib/agent/runtime/prismaControlPlane";
import type {
  PersistedCheckpoint,
  RunLease,
  RunTransition,
} from "../../../../../../agent-worker/src/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const leaseSchema = z
  .object({
    runId: z.string().min(1).max(128),
    workerId: z.string().min(1).max(128),
    version: z.number().int().nonnegative(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), workerId: z.string().min(1).max(128), leaseMs: z.number().int().min(5_000).max(120_000) }).strict(),
  z.object({ action: z.literal("load_checkpoint"), lease: leaseSchema }).strict(),
  z.object({ action: z.literal("heartbeat"), lease: leaseSchema, leaseMs: z.number().int().min(5_000).max(120_000) }).strict(),
  z.object({ action: z.literal("cancellation"), lease: leaseSchema }).strict(),
  z.object({ action: z.literal("save_checkpoint"), lease: leaseSchema, checkpoint: z.unknown() }).strict(),
  z.object({
    action: z.literal("append_event"),
    lease: leaseSchema,
    event: z.object({ sequence: z.number().int().nonnegative(), eventType: z.string().min(1).max(128), payload: z.record(z.unknown()) }).strict(),
  }).strict(),
  z.object({ action: z.literal("transition"), lease: leaseSchema, transition: z.unknown() }).strict(),
]);

function configured(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少内部 Agent 配置：${name}`);
  return value;
}

function success(data: unknown): Response {
  return Response.json({ ok: true, data });
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertAgentInternalRequest(request, configured("AGENT_INTERNAL_SERVICE_SECRET"));
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 2 * 1024 * 1024) {
      return Response.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "内部请求正文过大" } }, { status: 413 });
    }
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "内部运行时请求不符合契约" } }, { status: 400 });
    }
    const controlPlane = new PrismaAgentRuntimeControlPlane({
      delegationSecret: configured("AGENT_DELEGATION_SECRET"),
    });
    const input = parsed.data;
    switch (input.action) {
      case "claim": {
        const control = await getAgentControlSnapshot();
        if (!control.operational) return success(null);
        return success(await controlPlane.claimNext(input.workerId, input.leaseMs));
      }
      case "load_checkpoint":
        return success(await controlPlane.loadLatestCheckpoint(input.lease as RunLease));
      case "heartbeat":
        return success(await controlPlane.heartbeat(input.lease as RunLease, input.leaseMs));
      case "cancellation":
        return success(await controlPlane.isCancellationRequested(input.lease as RunLease));
      case "save_checkpoint":
        await controlPlane.saveCheckpoint(
          input.lease as RunLease,
          input.checkpoint as Omit<PersistedCheckpoint, "createdAt">,
        );
        return success(null);
      case "append_event":
        await controlPlane.appendEvent(input.lease as RunLease, input.event);
        return success(null);
      case "transition":
        await controlPlane.transition(input.lease as RunLease, input.transition as RunTransition);
        return success(null);
    }
  } catch (error: unknown) {
    if (error instanceof RuntimeLeaseConflictError) {
      return Response.json({ ok: false, error: { code: "CONTROL_PLANE_CONFLICT", message: error.message } }, { status: 409 });
    }
    return agentInternalErrorResponse(error);
  }
}
