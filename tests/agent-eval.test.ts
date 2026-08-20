import test from "node:test";
import assert from "node:assert/strict";
import { PROMPT_VERSION } from "../agent-worker/src/prompts";
import {
  ENTERPRISE_AGENT_EVAL_VERSION,
  evaluateEnterpriseAgentDataset,
} from "../src/lib/agent/eval/harness";
import { ENTERPRISE_AGENT_EVAL_CASES } from "./agent/fixtures/enterprise-agent-eval-v1";

test("企业 Agent v1 评测集不少于 50 条且元数据、版本和证据完整", () => {
  assert.equal(ENTERPRISE_AGENT_EVAL_CASES.length, 68);
  assert.equal(new Set(ENTERPRISE_AGENT_EVAL_CASES.map((item) => item.id)).size, 68);
  assert.ok(ENTERPRISE_AGENT_EVAL_CASES.every((item) => item.datasetVersion === ENTERPRISE_AGENT_EVAL_VERSION));
  assert.ok(ENTERPRISE_AGENT_EVAL_CASES.every((item) => item.versions.prompt === PROMPT_VERSION));
  assert.ok(ENTERPRISE_AGENT_EVAL_CASES.every((item) => item.question.length > 0));
  assert.ok(ENTERPRISE_AGENT_EVAL_CASES.every((item) => item.evidenceRefs.length > 0));
  assert.ok(ENTERPRISE_AGENT_EVAL_CASES.every((item) => item.allowedSideEffects.length > 0));
  assert.deepEqual(
    Object.fromEntries(
      ["schema", "permission", "prompt_injection", "governance"].map((category) => [
        category,
        ENTERPRISE_AGENT_EVAL_CASES.filter((item) => item.category === category).length,
      ]),
    ),
    { schema: 28, permission: 16, prompt_injection: 12, governance: 12 },
  );
});

test("企业 Agent 固定 judge 达到严格门禁且权限泄露、未确认写入为零", () => {
  const report = evaluateEnterpriseAgentDataset(
    ENTERPRISE_AGENT_EVAL_CASES,
    new Date("2026-08-13T00:00:00.000Z"),
  );
  assert.equal(report.total, 68);
  assert.equal(report.passed, 68);
  assert.equal(report.failed, 0);
  assert.equal(report.overallPassRate, 1);
  assert.deepEqual(report.categoryPassRates, {
    schema: 1,
    permission: 1,
    prompt_injection: 1,
    governance: 1,
  });
  assert.equal(report.permissionLeakageCount, 0);
  assert.equal(report.unconfirmedWriteCount, 0);
  assert.equal(report.evidenceCoverageRate, 1);
  assert.equal(report.estimatedModelCostMicros, 0);
  assert.equal(report.gatePassed, true);
});
