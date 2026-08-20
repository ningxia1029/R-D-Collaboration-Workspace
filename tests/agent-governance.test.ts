import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentGovernanceError,
  assertAgentRunTransition,
  assertManagerAssignment,
  assertOrgParentChange,
  canTransitionAgentRun,
  sanitizeAuditValue,
  validateWeeklyCapacityHours,
} from "../src/lib/agent/governance";

function expectGovernanceError(code: string, fn: () => unknown) {
  assert.throws(fn, (error: unknown) => error instanceof AgentGovernanceError && error.code === code);
}

test("Agent Run 状态机只允许显式路径", () => {
  assert.equal(canTransitionAgentRun("QUEUED", "RUNNING"), true);
  assert.equal(canTransitionAgentRun("RUNNING", "WAITING_FOR_USER"), true);
  assert.equal(canTransitionAgentRun("WAITING_FOR_USER", "RUNNING"), true);
  assert.doesNotThrow(() => assertAgentRunTransition("RUNNING", "SUCCEEDED"));
});

test("Agent Run 终态和非法跳转 fail closed", () => {
  expectGovernanceError("INVALID_AGENT_RUN_TRANSITION", () => assertAgentRunTransition("QUEUED", "SUCCEEDED"));
  expectGovernanceError("INVALID_AGENT_RUN_TRANSITION", () => assertAgentRunTransition("SUCCEEDED", "RUNNING"));
  expectGovernanceError("INVALID_AGENT_RUN_TRANSITION", () => assertAgentRunTransition("FAILED", "FAILED"));
});

test("周标准产能只接受 null 或 0–168 的有限数值", () => {
  assert.equal(validateWeeklyCapacityHours(null), null);
  assert.equal(validateWeeklyCapacityHours(0), 0);
  assert.equal(validateWeeklyCapacityHours(40), 40);
  assert.equal(validateWeeklyCapacityHours(168), 168);
  expectGovernanceError("INVALID_WEEKLY_CAPACITY", () => validateWeeklyCapacityHours(-1));
  expectGovernanceError("INVALID_WEEKLY_CAPACITY", () => validateWeeklyCapacityHours(169));
  expectGovernanceError("INVALID_WEEKLY_CAPACITY", () => validateWeeklyCapacityHours(Number.NaN));
});

test("用户不能成为自己的直属经理", () => {
  assert.doesNotThrow(() => assertManagerAssignment("u1", "u2"));
  assert.doesNotThrow(() => assertManagerAssignment("u1", null));
  expectGovernanceError("SELF_MANAGER_NOT_ALLOWED", () => assertManagerAssignment("u1", "u1"));
});

test("组织父子关系拒绝自引用、未知父节点和循环", () => {
  const parents = new Map<string, string | null>([
    ["root", null],
    ["hardware", "root"],
    ["algorithm", "hardware"],
  ]);
  assert.doesNotThrow(() => assertOrgParentChange("algorithm", "root", parents));
  expectGovernanceError("ORG_SELF_PARENT_NOT_ALLOWED", () => assertOrgParentChange("algorithm", "algorithm", parents));
  expectGovernanceError("ORG_PARENT_NOT_FOUND", () => assertOrgParentChange("algorithm", "missing", parents));
  expectGovernanceError("ORG_CYCLE_NOT_ALLOWED", () => assertOrgParentChange("root", "algorithm", parents));
});

test("审计摘要脱敏敏感键并限制体积和循环引用", () => {
  const input: Record<string, unknown> = {
    user: "alice",
    password: "do-not-store",
    nested: { authorization: "Bearer secret", api_key: "key", note: "x".repeat(1_100) },
  };
  input.circular = input;
  const sanitized = sanitizeAuditValue(input) as Record<string, unknown>;

  assert.equal(sanitized.user, "alice");
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal((sanitized.nested as Record<string, unknown>).authorization, "[REDACTED]");
  assert.equal((sanitized.nested as Record<string, unknown>).api_key, "[REDACTED]");
  assert.match((sanitized.nested as Record<string, string>).note, /\[TRUNCATED\]$/);
  assert.equal(sanitized.circular, "[CIRCULAR]");
});
