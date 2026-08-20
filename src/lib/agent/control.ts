import type { AgentControlSetting, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TOOL_NAMES, toolNameSchema, type ToolName } from "@/lib/agent/tools/contracts";
import { writeAudit } from "@/lib/audit";

const CONTROL_ID = "default";
const MIN_SECRET_BYTES = 32;

export interface AgentControlSnapshot {
  enabled: boolean;
  configurationReady: boolean;
  operational: boolean;
  disabledTools: ToolName[];
  maintenanceMessage: string | null;
  updatedAt: string | null;
}

export interface AgentEnvironmentStatus {
  configurationReady: boolean;
  missingConfigurationCount: number;
}

interface AgentSecretEnvironment extends Record<string, string | undefined> {
  AGENT_INTERNAL_SERVICE_SECRET?: string;
  AGENT_DELEGATION_SECRET?: string;
  AGENT_CURSOR_SECRET?: string;
}

function secretReady(value: string | undefined): boolean {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= MIN_SECRET_BYTES;
}

export function inspectAgentEnvironment(
  env: AgentSecretEnvironment = process.env,
): AgentEnvironmentStatus {
  const values = [env.AGENT_INTERNAL_SERVICE_SECRET, env.AGENT_DELEGATION_SECRET, env.AGENT_CURSOR_SECRET];
  const missingConfigurationCount = values.filter((value) => !secretReady(value)).length;
  return { configurationReady: missingConfigurationCount === 0, missingConfigurationCount };
}

export function normalizeDisabledTools(value: Prisma.JsonValue | null | undefined): ToolName[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<ToolName>();
  for (const candidate of value) {
    const parsed = toolNameSchema.safeParse(candidate);
    if (parsed.success) unique.add(parsed.data);
  }
  return TOOL_NAMES.filter((tool) => unique.has(tool));
}

function toSnapshot(
  row: Pick<AgentControlSetting, "enabled" | "disabledToolsJson" | "maintenanceMessage" | "updatedAt"> | null,
  env: NodeJS.ProcessEnv,
): AgentControlSnapshot {
  const environment = inspectAgentEnvironment(env);
  // 数据库尚未初始化控制行时仍保持默认关闭，不能仅靠环境变量意外开放企业 Agent。
  const enabled = row?.enabled ?? false;
  return {
    enabled,
    configurationReady: environment.configurationReady,
    operational: enabled && environment.configurationReady,
    disabledTools: normalizeDisabledTools(row?.disabledToolsJson),
    maintenanceMessage: row?.maintenanceMessage ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function getAgentControlSnapshot(
  db: PrismaClient = prisma,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentControlSnapshot> {
  const row = await db.agentControlSetting.findUnique({
    where: { id: CONTROL_ID },
    select: { enabled: true, disabledToolsJson: true, maintenanceMessage: true, updatedAt: true },
  });
  return toSnapshot(row, env);
}

export async function updateAgentControl(
  input: { enabled: boolean; disabledTools: readonly ToolName[]; maintenanceMessage?: string | null; updatedById: string },
  tx: Prisma.TransactionClient,
): Promise<AgentControlSetting> {
  const disabledTools = TOOL_NAMES.filter((tool) => input.disabledTools.includes(tool));
  return tx.agentControlSetting.upsert({
    where: { id: CONTROL_ID },
    create: {
      id: CONTROL_ID,
      enabled: input.enabled,
      disabledToolsJson: disabledTools,
      maintenanceMessage: input.maintenanceMessage?.trim() || null,
      updatedById: input.updatedById,
    },
    update: {
      enabled: input.enabled,
      disabledToolsJson: disabledTools,
      maintenanceMessage: input.maintenanceMessage?.trim() || null,
      updatedById: input.updatedById,
    },
  });
}

export async function applyAgentControlPolicy(
  input: {
    enabled: boolean;
    disabledTools: readonly ToolName[];
    maintenanceMessage?: string | null;
    updatedById: string;
  },
  db: PrismaClient = prisma,
): Promise<AgentControlSnapshot> {
  const before = await getAgentControlSnapshot(db);
  await db.$transaction(async (tx) => {
    await updateAgentControl(input, tx);
    if (!input.enabled && before.enabled) {
      const now = new Date();
      // 停止领取由内部 claim 端执行；此处同时确定性终止未运行 Run，并请求运行中 Worker 取消。
      await tx.agentRun.updateMany({
        where: { status: { in: ["QUEUED", "WAITING_FOR_USER"] } },
        data: { status: "CANCELLED", currentNode: "admin_kill_switch", completedAt: now, cancelRequestedAt: now },
      });
      const immediatelyCancelled = await tx.agentRun.findMany({
        where: { status: "CANCELLED", currentNode: "admin_kill_switch", cancelRequestedAt: now },
        select: { id: true, events: { orderBy: { sequence: "desc" }, take: 1, select: { sequence: true } } },
      });
      for (const run of immediatelyCancelled) {
        await tx.agentRunEvent.create({
          data: {
            runId: run.id,
            sequence: (run.events[0]?.sequence ?? 0) + 1,
            eventType: "RUN_CANCELLED",
            payload: { by: "admin_kill_switch" },
          },
        });
      }
      await tx.agentRun.updateMany({
        where: { status: "RUNNING", cancelRequestedAt: null },
        data: { cancelRequestedAt: now },
      });
    }
    await writeAudit(
      {
        userId: input.updatedById,
        action: "UPDATE",
        entityType: "AGENT_CONTROL",
        entityId: CONTROL_ID,
        diff: {
          before: { enabled: before.enabled, disabledTools: before.disabledTools },
          after: { enabled: input.enabled, disabledTools: input.disabledTools },
        },
        metadata: { maintenanceMessageConfigured: Boolean(input.maintenanceMessage) },
      },
      tx,
    );
  });
  return getAgentControlSnapshot(db);
}
