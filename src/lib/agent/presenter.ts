import { evidenceRefSchema, toolWarningSchema, type ToolName } from "@/lib/agent/tools/contracts";
import type { PortableRuntimeState } from "../../../agent-worker/src/protocol";

export interface PresentedEvidence {
  evidenceId: string;
  kind: "entity" | "aggregate" | "document_chunk";
  entityType: string;
  entityId?: string;
  projectId?: string | null;
  label: string;
  uri?: string;
  version: { type: "updated_at" | "doc_version" | "snapshot"; value: string };
  excerpt?: string;
}

export interface PresentedToolResult {
  tool: ToolName | string;
  ok: boolean;
  asOf: string | null;
  evidence: PresentedEvidence[];
  warnings: Array<{ code: string; message: string; field?: string }>;
  scope: { projectIds: string[]; permissionsApplied: string[]; redactions: string[] } | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : [];
}

export function parsePortableRuntimeState(value: unknown): PortableRuntimeState | null {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || !Array.isArray(value.toolResults)) return null;
  return value as unknown as PortableRuntimeState;
}

export function presentToolResults(stateValue: unknown): PresentedToolResult[] {
  const state = parsePortableRuntimeState(stateValue);
  if (!state) return [];
  return state.toolResults.slice(0, 20).map((result) => {
    const output = isRecord(result.output) ? result.output : {};
    const evidence = Array.isArray(output.evidence)
      ? output.evidence
          .map((candidate) => evidenceRefSchema.safeParse(candidate))
          .filter((candidate) => candidate.success)
          .map((candidate) => candidate.data as PresentedEvidence)
          .slice(0, 200)
      : [];
    const warnings = Array.isArray(output.warnings)
      ? output.warnings
          .map((candidate) => toolWarningSchema.safeParse(candidate))
          .filter((candidate) => candidate.success)
          .map((candidate) => candidate.data)
          .slice(0, 50)
      : [];
    const rawScope = isRecord(output.scope) ? output.scope : null;
    const rawError = isRecord(output.error) ? output.error : null;
    return {
      tool: result.tool,
      ok: output.ok === true,
      asOf: typeof output.asOf === "string" ? output.asOf : null,
      evidence,
      warnings,
      scope: rawScope
        ? {
            projectIds: stringArray(rawScope.projectIds, 100),
            permissionsApplied: stringArray(rawScope.permissionsApplied, 20),
            redactions: stringArray(rawScope.redactions, 50),
          }
        : null,
      error:
        rawError && typeof rawError.code === "string" && typeof rawError.message === "string"
          ? {
              code: rawError.code,
              message: rawError.message,
              retryable: rawError.retryable === true,
            }
          : null,
    };
  });
}

export function clarificationFromState(stateValue: unknown): string | null {
  const state = parsePortableRuntimeState(stateValue);
  return typeof state?.clarification === "string" ? state.clarification : null;
}
