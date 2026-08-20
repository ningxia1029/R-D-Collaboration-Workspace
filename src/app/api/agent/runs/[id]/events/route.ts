import { prisma } from "@/lib/prisma";
import { ApiError, apiError, requireAuth } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_END_STATUSES = new Set(["WAITING_FOR_USER", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);

function sse(event: string, id: number | undefined, data: unknown): Uint8Array {
  const lines = [id === undefined ? "" : `id: ${id}`, `event: ${event}`, `data: ${JSON.stringify(data)}`, ""];
  return new TextEncoder().encode(`${lines.filter((line, index) => line || index > 0).join("\n")}\n`);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    const owned = await prisma.agentRun.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!owned) throw new ApiError(404, "Agent Run 不存在");
    const url = new URL(request.url);
    const requestedSince = Number(url.searchParams.get("since") ?? request.headers.get("last-event-id") ?? "0");
    const initialSince = Number.isSafeInteger(requestedSince) && requestedSince >= 0 ? requestedSince : 0;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let since = initialSince;
        controller.enqueue(new TextEncoder().encode("retry: 2000\n\n"));
        try {
          while (!request.signal.aborted) {
            const [events, run] = await Promise.all([
              prisma.agentRunEvent.findMany({
                where: { runId: id, sequence: { gt: since } },
                orderBy: { sequence: "asc" },
                take: 100,
                select: { sequence: true, eventType: true, payload: true, createdAt: true },
              }),
              prisma.agentRun.findFirst({
                where: { id, userId: user.id },
                select: { status: true, currentNode: true, updatedAt: true },
              }),
            ]);
            if (!run) break;
            for (const event of events) {
              since = event.sequence;
              controller.enqueue(sse("run-event", event.sequence, event));
            }
            controller.enqueue(sse("run-status", undefined, run));
            if (STREAM_END_STATUSES.has(run.status) && events.length < 100) break;
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        } catch (error: unknown) {
          if (!request.signal.aborted) {
            const message = error instanceof Error ? error.name : "StreamError";
            controller.enqueue(sse("stream-error", undefined, { message }));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
