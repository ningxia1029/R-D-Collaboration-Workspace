import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { applyAgentControlPolicy, getAgentControlSnapshot, inspectAgentEnvironment } from "@/lib/agent/control";
import { TOOL_NAMES, type ToolName } from "@/lib/agent/tools/contracts";
import { apiError, requirePerm } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const toolEnum = z.enum([...TOOL_NAMES] as [ToolName, ...ToolName[]]);
const updateSchema = z
  .object({
    enabled: z.boolean(),
    disabledTools: z.array(toolEnum).max(TOOL_NAMES.length),
    maintenanceMessage: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export async function GET() {
  try {
    await requirePerm("admin:audit_read");
    const [control, statusGroups, lastHeartbeat, recentFailures] = await Promise.all([
      getAgentControlSnapshot(),
      prisma.agentRun.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.agentRun.findFirst({
        where: { heartbeatAt: { not: null } },
        orderBy: { heartbeatAt: "desc" },
        select: { heartbeatAt: true, leaseOwnerId: true },
      }),
      prisma.agentRun.findMany({
        where: { status: "FAILED" },
        orderBy: { completedAt: "desc" },
        take: 10,
        select: { id: true, userId: true, failureCode: true, completedAt: true },
      }),
    ]);
    return Response.json({
      control,
      environment: inspectAgentEnvironment(),
      tools: TOOL_NAMES.map((name) => ({ name, enabled: !control.disabledTools.includes(name) })),
      runsByStatus: Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all])),
      worker: { lastHeartbeatAt: lastHeartbeat?.heartbeatAt ?? null, lastWorkerId: lastHeartbeat?.leaseOwnerId ?? null },
      recentFailures,
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requirePerm("admin:audit_read");
    const input = updateSchema.parse(await request.json());
    return Response.json(await applyAgentControlPolicy({ ...input, updatedById: user.id }));
  } catch (error: unknown) {
    return apiError(error);
  }
}
