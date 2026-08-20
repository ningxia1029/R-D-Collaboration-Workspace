import { createHash } from "node:crypto";
import { ApiError } from "@/lib/rbac";
import {
  TOOL_CONTRACT_VERSION,
  toolExecutionContextSchema,
  type ToolErrorCode,
  type ToolExecutionContext,
  type ToolName,
} from "@/lib/agent/tools/contracts";
import { CursorCodec, filterFingerprint } from "@/lib/agent/tools/cursor";
import { ToolInvocationError } from "@/lib/agent/tools/errors";
import { createToolRegistry, type AnyToolDescriptor, type ToolRegistry } from "@/lib/agent/tools/registry";
import { assertIanaTimezone } from "@/lib/agent/tools/time";
import type { ToolAuditEvent, ToolDependencies } from "@/lib/agent/tools/types";

export interface ModelToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sideEffect: "none" | "proposal";
  timeoutMs: number;
}

type Failure = {
  ok: false;
  contractVersion: "1.0";
  tool: ToolName;
  requestId: string;
  traceId: string;
  error: {
    code: ToolErrorCode;
    message: string;
    retryable: boolean;
    details?: Array<{ field?: string; code: string; message: string }>;
  };
  asOf: string;
};

function safeContextField(context: unknown, field: "requestId" | "traceId"): string {
  if (context && typeof context === "object") {
    const value = (context as Record<string, unknown>)[field];
    if (typeof value === "string" && value.length > 0 && value.length <= 128) return value;
  }
  return `invalid-${field}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function errorToFailure(
  descriptor: AnyToolDescriptor,
  context: Pick<ToolExecutionContext, "requestId" | "traceId">,
  asOf: Date,
  error: unknown,
): Failure {
  let normalized: ToolInvocationError;
  if (error instanceof ToolInvocationError) {
    normalized = error;
  } else if (error instanceof ApiError) {
    normalized =
      error.status === 401
        ? new ToolInvocationError("auth_required", "登录状态无效，请重新登录")
        : error.status === 403 || error.status === 404
          ? new ToolInvocationError("resource_not_accessible", "目标资源不存在或当前账号无权访问")
          : error.status === 409
            ? new ToolInvocationError("conflict", "数据状态已变化，请刷新后重试")
            : new ToolInvocationError("internal_error", "Tool 执行失败，请联系管理员并提供 traceId");
  } else {
    normalized = new ToolInvocationError("internal_error", "Tool 执行失败，请联系管理员并提供 traceId");
    const errorKind = error instanceof Error ? error.name : typeof error;
    console.error(`[agent-tools] ${descriptor.name} 执行失败 trace=${context.traceId} kind=${errorKind}`);
  }
  return {
    ok: false,
    contractVersion: TOOL_CONTRACT_VERSION,
    tool: descriptor.name,
    requestId: context.requestId,
    traceId: context.traceId,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
    asOf: asOf.toISOString(),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ToolInvocationError("timeout", `Tool 超过 ${timeoutMs}ms 执行上限`, true)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class ToolGateway {
  readonly registry: ToolRegistry;
  private readonly cursorCodec: CursorCodec;
  private readonly clock: () => Date;

  constructor(private readonly dependencies: ToolDependencies, registry?: ToolRegistry) {
    this.registry = registry ?? createToolRegistry(dependencies);
    this.cursorCodec = new CursorCodec(dependencies.cursorSecret);
    this.clock = dependencies.clock ?? (() => new Date());
  }

  listModelTools(): ModelToolDefinition[] {
    return Array.from(this.registry.values())
      .filter((descriptor) => descriptor.status === "enabled")
      .map((descriptor) => ({
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: descriptor.inputJsonSchema,
        outputSchema: descriptor.outputJsonSchema,
        sideEffect: descriptor.sideEffect,
        timeoutMs: descriptor.timeoutMs,
      }));
  }

  async invoke(tool: ToolName, rawInput: unknown, rawContext: unknown): Promise<unknown> {
    const descriptor = this.registry.get(tool);
    if (!descriptor) throw new Error(`未注册 Tool：${tool}`);

    const startedAt = this.clock();
    let inputHash = createHash("sha256").update("unparsed").digest("hex");
    let projectIds: string[] = [];
    let orgUnitIds: string[] = [];
    let evidenceIds: string[] = [];
    let result: unknown;
    let auditErrorCode: ToolErrorCode | undefined;
    let contextForAudit: Pick<ToolExecutionContext, "runId" | "requestId" | "traceId"> = {
      runId: "invalid-runId",
      requestId: safeContextField(rawContext, "requestId"),
      traceId: safeContextField(rawContext, "traceId"),
    };

    try {
      const parsedContext = toolExecutionContextSchema.safeParse(rawContext);
      if (!parsedContext.success) {
        const details = parsedContext.error.issues.slice(0, 50).map((issue) => ({
          field: issue.path.join(".") || undefined,
          code: issue.code,
          message: issue.message,
        }));
        throw new ToolInvocationError("validation_error", "受信执行上下文不符合契约", false, details);
      }
      const context = parsedContext.data;
      contextForAudit = context;
      assertIanaTimezone(context.timezone);
      const expiresAt = new Date(context.expiresAt);
      if (expiresAt <= startedAt) throw new ToolInvocationError("auth_expired", "委托上下文已过期，请重新发起请求");
      if (new Date(context.issuedAt).getTime() > startedAt.getTime() + 5 * 60_000) {
        throw new ToolInvocationError("auth_required", "委托上下文签发时间无效，请重新登录");
      }

      if (descriptor.status !== "enabled" || !descriptor.handler) {
        const code = descriptor.status === "data_not_ready" ? "data_not_ready" : "tool_disabled";
        throw new ToolInvocationError(code, descriptor.disabledReason ?? "Tool 当前未启用");
      }

      const parsedInput = descriptor.inputSchema.safeParse(rawInput);
      if (!parsedInput.success) {
        const details = parsedInput.error.issues.slice(0, 50).map((issue) => ({
          field: issue.path.join(".") || undefined,
          code: issue.code,
          message: issue.message,
        }));
        throw new ToolInvocationError("validation_error", "Tool 输入参数不符合契约", false, details);
      }

      inputHash = filterFingerprint(parsedInput.data);
      const cursorValue =
        parsedInput.data && typeof parsedInput.data === "object"
          ? (parsedInput.data as Record<string, unknown>).cursor
          : undefined;
      const cursorPosition =
        typeof cursorValue === "string" ? this.cursorCodec.decode(cursorValue, descriptor.name, inputHash) : undefined;
      const user = await this.dependencies.authorizer.resolveSubject(context.sessionSubject);
      const outcome = await withTimeout(
        descriptor.handler({ input: parsedInput.data, context, user, asOf: startedAt, cursorPosition }),
        descriptor.timeoutMs,
      );
      projectIds = unique(outcome.projectIds);
      orgUnitIds = unique(outcome.orgUnitIds ?? []);
      evidenceIds = outcome.evidence.map((evidence) => evidence.evidenceId);
      if (new Set(evidenceIds).size !== evidenceIds.length) {
        throw new ToolInvocationError("internal_error", "Tool 生成了重复 evidenceId，请联系管理员并提供 traceId");
      }
      const page = outcome.page
        ? {
            limit: outcome.page.limit,
            hasMore: outcome.page.hasMore,
            nextCursor:
              outcome.page.hasMore && outcome.page.lastId
                ? this.cursorCodec.encode(descriptor.name, inputHash, { id: outcome.page.lastId })
                : null,
          }
        : undefined;
      if (outcome.page?.hasMore && !outcome.page.lastId) {
        throw new ToolInvocationError("internal_error", "分页结果缺少稳定游标位置");
      }

      const candidate = {
        ok: true,
        contractVersion: TOOL_CONTRACT_VERSION,
        tool: descriptor.name,
        requestId: context.requestId,
        traceId: context.traceId,
        data: outcome.data,
        evidence: outcome.evidence,
        asOf: startedAt.toISOString(),
        scope: {
          projectIds,
          ...(orgUnitIds.length ? { orgUnitIds } : {}),
          permissionsApplied: unique(outcome.permissionsApplied),
          redactions: unique(outcome.redactions),
        },
        warnings: outcome.warnings,
        ...(page ? { page } : {}),
      };
      const validatedOutput = descriptor.outputSchema.safeParse(candidate);
      if (!validatedOutput.success) {
        console.error(`[agent-tools] ${descriptor.name} 输出契约校验失败 trace=${context.traceId}`, validatedOutput.error.issues);
        throw new ToolInvocationError("internal_error", "Tool 输出未通过契约校验，请联系管理员并提供 traceId");
      }
      result = validatedOutput.data;
    } catch (error: unknown) {
      const asOf = this.clock();
      const context = {
        requestId: contextForAudit.requestId,
        traceId: contextForAudit.traceId,
      };
      result = errorToFailure(descriptor, context, asOf, error);
      auditErrorCode = (result as Failure).error.code;
    }

    const durationMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
    const auditEvent: ToolAuditEvent = {
      runId: contextForAudit.runId,
      requestId: contextForAudit.requestId,
      traceId: contextForAudit.traceId,
      tool: descriptor.name,
      contractVersion: TOOL_CONTRACT_VERSION,
      status: (result as { ok?: boolean }).ok ? "SUCCEEDED" : "FAILED",
      inputHash,
      projectIds,
      evidenceIds,
      ...(auditErrorCode ? { errorCode: auditErrorCode } : {}),
      durationMs,
    };
    try {
      await this.dependencies.auditSink.record(auditEvent);
    } catch (auditError: unknown) {
      const errorKind = auditError instanceof Error ? auditError.name : typeof auditError;
      console.error(`[agent-tools] 审计写入失败 trace=${contextForAudit.traceId} kind=${errorKind}`);
      result = errorToFailure(
        descriptor,
        contextForAudit,
        this.clock(),
        new ToolInvocationError("dependency_unavailable", "Tool 审计服务不可用，本次结果未返回", true),
      );
    }

    const finalOutput = descriptor.outputSchema.safeParse(result);
    if (!finalOutput.success) {
      throw new Error(`Tool ${descriptor.name} 最终响应未通过契约校验`);
    }
    return finalOutput.data;
  }
}
