import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectAgentEnvironment, normalizeDisabledTools } from "../src/lib/agent/control";
import { clarificationFromState, presentToolResults } from "../src/lib/agent/presenter";
import type { PortableRuntimeState } from "../agent-worker/src/protocol";

const SECRET = "phase-four-secret-that-is-at-least-32-bytes";

test("Agent 控制面缺失任一内部密钥时保持不可运行", () => {
  assert.deepEqual(inspectAgentEnvironment({}), { configurationReady: false, missingConfigurationCount: 3 });
  assert.deepEqual(
    inspectAgentEnvironment({
      AGENT_INTERNAL_SERVICE_SECRET: SECRET,
      AGENT_DELEGATION_SECRET: SECRET,
      AGENT_CURSOR_SECRET: SECRET,
    }),
    { configurationReady: true, missingConfigurationCount: 0 },
  );
  assert.equal(
    inspectAgentEnvironment({
      AGENT_INTERNAL_SERVICE_SECRET: "short",
      AGENT_DELEGATION_SECRET: SECRET,
      AGENT_CURSOR_SECRET: SECRET,
    }).configurationReady,
    false,
  );
});

test("停用 Tool 清单只接受注册名、去重并保持注册顺序", () => {
  assert.deepEqual(
    normalizeDisabledTools([
      "plm_task_list",
      "not_registered",
      "plm_project_resolve",
      "plm_task_list",
      42,
    ]),
    ["plm_project_resolve", "plm_task_list"],
  );
});

test("前台 Presenter 仅输出白名单证据、范围、警告和错误摘要", () => {
  const state: PortableRuntimeState = {
    schemaVersion: "1.0",
    runId: "run-ui",
    traceId: "trace-ui",
    question: "问题",
    phase: "WAITING_FOR_USER",
    stepCount: 1,
    toolCallCount: 1,
    inputTokenCount: 10,
    outputTokenCount: 5,
    estimatedCostMicros: 0,
    resultBytes: 1,
    eventSequence: 2,
    toolResults: [
      {
        callId: "call-1",
        requestId: "run-ui:call-1:0",
        tool: "plm_project_get_summary",
        bytes: 1,
        output: {
          ok: true,
          asOf: "2026-08-12T06:00:00.000Z",
          data: { privateRawRows: [{ password: "must-not-leak" }] },
          evidence: [
            {
              evidenceId: "project:p1:summary",
              kind: "aggregate",
              entityType: "PROJECT",
              entityId: "p1",
              projectId: "p1",
              label: "P1 项目汇总",
              uri: "/projects/p1/tasks",
              version: { type: "snapshot", value: "2026-08-12T06:00:00.000Z" },
            },
            { malformed: true },
          ],
          warnings: [{ code: "PARTIAL", message: "部分数据已裁剪" }, { malformed: true }],
          scope: { projectIds: ["p1", 2], permissionsApplied: ["project:read"], redactions: ["email"] },
        },
      },
    ],
    clarification: "请确认项目。",
    lastNode: "wait",
  };
  const presented = presentToolResults(state);
  assert.equal(presented.length, 1);
  assert.equal(presented[0].evidence.length, 1);
  assert.deepEqual(presented[0].scope?.projectIds, ["p1"]);
  assert.deepEqual(presented[0].warnings, [{ code: "PARTIAL", message: "部分数据已裁剪" }]);
  assert.equal(clarificationFromState(state), "请确认项目。");
  assert.equal(JSON.stringify(presented).includes("must-not-leak"), false);
});

test("用户 Run API 使用认证主体而非请求中的 userId", async () => {
  const [collectionRoute, detailRoute, eventRoute] = await Promise.all([
    readFile("src/app/api/agent/runs/route.ts", "utf8"),
    readFile("src/app/api/agent/runs/[id]/route.ts", "utf8"),
    readFile("src/app/api/agent/runs/[id]/events/route.ts", "utf8"),
  ]);
  assert.match(collectionRoute, /requireAuth\(\)/);
  assert.doesNotMatch(collectionRoute, /userId:\s*(?:parsed|input|body)/);
  assert.match(detailRoute, /const\s+\{\s*id\s*\}\s*=\s*await\s+params/);
  assert.match(detailRoute, /getOwnedAgentRun\(user, id\)/);
  assert.match(eventRoute, /where:\s*\{\s*id,\s*userId:\s*user\.id\s*\}/);
});
