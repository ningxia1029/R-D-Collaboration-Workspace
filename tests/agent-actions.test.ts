import test from "node:test";
import assert from "node:assert/strict";
import type { PermissionCode } from "../src/lib/constants";
import type { SessionUser } from "../src/lib/rbac";
import { ACTION_DEFINITIONS } from "../src/lib/agent/actions/registry";
import { issueApprovalToken, verifyApprovalToken } from "../src/lib/agent/actions/token";
import { InternalToolAdapter, McpToolAdapter } from "../src/lib/agent/tools/adapters";
import { toolNameSchema, type ToolExecutionContext } from "../src/lib/agent/tools/contracts";
import { ToolGateway } from "../src/lib/agent/tools/gateway";
import type {
  TaskUpdateProposalRecord,
  ToolActionProposalService,
  ToolAuditEvent,
  ToolAuthorizer,
  ToolReadDataSource,
} from "../src/lib/agent/tools/types";

const NOW = new Date("2026-08-13T05:00:00.000Z");
const SECRET = "phase-seven-action-approval-secret-at-least-32-bytes";
const user: SessionUser = {
  id: "action-user",
  email: "action-user@invalid.local",
  name: "动作验收用户",
  roleId: "role-pm",
  roleName: "pm",
};

function context(): ToolExecutionContext {
  return {
    runId: "action-run",
    traceId: "action-trace",
    requestId: "action-run:proposal:0",
    sessionSubject: user.id,
    issuedAt: "2026-08-13T04:59:00.000Z",
    expiresAt: "2026-08-13T06:00:00.000Z",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
  };
}

class ActionAuthorizer implements ToolAuthorizer {
  async resolveSubject(subject: string): Promise<SessionUser> {
    if (subject !== user.id) throw new Error("invalid subject");
    return user;
  }
  async visibleProjectIds() { return ["project-action"]; }
  async visibleOrgUnitIds() { return []; }
  async authorizeWorkloadScope() { return { userIds: [user.id], orgUnitIds: [], permissionsApplied: [] }; }
  async assertPermissions(_user: SessionUser, _permissions: readonly PermissionCode[]) {}
}

class FakeProposalService implements ToolActionProposalService {
  calls = 0;
  async proposeTaskUpdate(): Promise<{ proposal: TaskUpdateProposalRecord; permissionsApplied: string[] }> {
    this.calls += 1;
    return {
      proposal: {
        proposalId: "proposal-action",
        approvalRequestId: "proposal-action",
        actionType: "TASK_UPDATE_LOW_RISK",
        status: "PENDING",
        riskLevel: "LOW",
        target: { taskId: "task-action", projectId: "project-action", title: "阶段 7 验收任务" },
        before: { priority: "P2" },
        after: { priority: "P1" },
        expectedVersion: "2026-08-13T04:00:00.000Z",
        expiresAt: "2026-08-13T05:15:00.000Z",
        confirmationRequired: true,
        executionToolExposedToModel: false,
      },
      permissionsApplied: ["task:update"],
    };
  }
}

function makeGateway() {
  const proposalService = new FakeProposalService();
  const audits: ToolAuditEvent[] = [];
  const gateway = new ToolGateway({
    dataSource: {} as ToolReadDataSource,
    authorizer: new ActionAuthorizer(),
    auditSink: { async record(event) { audits.push(event); } },
    actionProposalService: proposalService,
    cursorSecret: "phase-seven-cursor-secret-at-least-32-bytes",
    clock: () => new Date(NOW),
  });
  return { gateway, proposalService, audits };
}

test("动作风险注册表仅启用低风险任务字段更新，高风险动作全部显式禁用", () => {
  const enabled = ACTION_DEFINITIONS.filter((definition) => definition.status === "enabled");
  assert.deepEqual(enabled.map((definition) => definition.actionType), ["TASK_UPDATE_LOW_RISK"]);
  assert.deepEqual(enabled[0].allowedFields, ["description", "priority", "dueDate", "estimatedHours"]);
  for (const actionType of ["TASK_DELETE", "CHANGE_APPROVE", "PRODUCT_RELEASE", "ECO_IMPLEMENT", "BULK_IMPORT"]) {
    const definition = ACTION_DEFINITIONS.find((candidate) => candidate.actionType === actionType);
    assert.equal(definition?.status, "disabled");
    assert.ok(definition?.riskLevel === "HIGH" || definition?.riskLevel === "FORBIDDEN");
  }
});

test("一次性确认令牌绑定提议、用户、版本与到期时间，篡改或过期均失败", () => {
  const token = issueApprovalToken({
    proposalId: "proposal-action",
    userId: user.id,
    nonceHash: "a".repeat(64),
    expectedVersion: "2026-08-13T04:00:00.000Z",
    expiresAt: new Date("2026-08-13T05:15:00.000Z"),
  }, SECRET, NOW);
  const payload = verifyApprovalToken(token, SECRET, NOW);
  assert.equal(payload.proposalId, "proposal-action");
  assert.equal(payload.userId, user.id);
  assert.throws(() => verifyApprovalToken(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`, SECRET, NOW));
  assert.throws(() => verifyApprovalToken(token, SECRET, new Date("2026-08-13T05:11:00.000Z")));
});

test("模型仅能调用 proposal Tool，严格 schema 拒绝确认令牌注入", async () => {
  const { gateway, proposalService, audits } = makeGateway();
  const definitions = gateway.listModelTools();
  const action = definitions.find((definition) => definition.name === "plm_action_propose_task_update");
  assert.equal(action?.sideEffect, "proposal");
  assert.equal(definitions.filter((definition) => definition.sideEffect === "proposal").length, 1);
  assert.equal(toolNameSchema.safeParse("plm_action_execute").success, false);

  const result = await gateway.invoke("plm_action_propose_task_update", {
    taskId: "task-action",
    changes: { priority: "P1" },
    reason: "降低阻塞风险",
    idempotencyKey: "action-key-001",
  }, context()) as Record<string, any>;
  assert.equal(result.ok, true);
  assert.equal(result.data.confirmationRequired, true);
  assert.equal(result.data.executionToolExposedToModel, false);
  assert.equal(proposalService.calls, 1);
  assert.equal(audits.length, 1);

  const injected = await gateway.invoke("plm_action_propose_task_update", {
    taskId: "task-action",
    changes: { priority: "P1" },
    idempotencyKey: "action-key-002",
    approvalToken: "prompt-injection-bypass",
  }, { ...context(), requestId: "action-run:proposal:1" }) as Record<string, any>;
  assert.equal(injected.ok, false);
  assert.equal(injected.error.code, "validation_error");
  assert.equal(proposalService.calls, 1);
});

test("内部与 MCP Adapter 复用契约，proposal 明确标记为非只读且非破坏性", () => {
  const { gateway } = makeGateway();
  const internal = new InternalToolAdapter(gateway).listTools();
  const mcp = new McpToolAdapter(gateway).listTools();
  const actionInternal = internal.find((definition) => definition.name === "plm_action_propose_task_update");
  const actionMcp = mcp.find((definition) => definition.name === "plm_action_propose_task_update");
  assert.deepEqual(actionMcp?.inputSchema, actionInternal?.inputSchema);
  assert.equal(actionMcp?.annotations.readOnlyHint, false);
  assert.equal(actionMcp?.annotations.destructiveHint, false);
  assert.equal(actionMcp?.annotations.idempotentHint, true);
});
