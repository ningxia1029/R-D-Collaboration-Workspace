import test from "node:test";
import assert from "node:assert/strict";
import { memberGetWorkloadInputSchema } from "../src/lib/agent/tools/contracts";
import { countWeekdaysInclusive, endExclusiveOfLocalDate, startOfLocalDate } from "../src/lib/agent/tools/time";
import { collectOrgSubtreeIds, orgAncestorIds } from "../src/lib/services/organizationScope";

test("组织子树和祖先链确定性去重，即使脏数据有环也不会无限循环", () => {
  const rows = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "a" },
    { id: "cycle-1", parentId: "cycle-2" },
    { id: "cycle-2", parentId: "cycle-1" },
  ];
  assert.deepEqual(collectOrgSubtreeIds(rows, ["root"]), ["root", "a", "b"]);
  assert.deepEqual(new Set(collectOrgSubtreeIds(rows, ["cycle-1"])), new Set(["cycle-1", "cycle-2"]));
  assert.deepEqual(orgAncestorIds(rows, "b"), ["b", "a", "root"]);
});

test("负载工作日按周一至周五计算，Asia/Shanghai 日界线转换正确", () => {
  assert.equal(countWeekdaysInclusive("2026-08-10", "2026-08-16"), 5);
  assert.equal(countWeekdaysInclusive("2026-08-15", "2026-08-16"), 0);
  assert.equal(startOfLocalDate("2026-08-10", "Asia/Shanghai").toISOString(), "2026-08-09T16:00:00.000Z");
  assert.equal(endExclusiveOfLocalDate("2026-08-10", "Asia/Shanghai").toISOString(), "2026-08-10T16:00:00.000Z");
});

test("负载契约拒绝倒置窗口、超过 92 天和冲突项目范围", () => {
  const base = { scope: { type: "users" as const, userIds: ["u1"] }, dateFrom: "2026-08-01", dateTo: "2026-08-31" };
  assert.equal(memberGetWorkloadInputSchema.safeParse(base).success, true);
  assert.equal(memberGetWorkloadInputSchema.safeParse({ ...base, dateFrom: "2026-09-01" }).success, false);
  assert.equal(memberGetWorkloadInputSchema.safeParse({ ...base, dateTo: "2026-12-31" }).success, false);
  assert.equal(memberGetWorkloadInputSchema.safeParse({
    scope: { type: "project", projectId: "p1" },
    projectId: "p2",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
  }).success, false);
});
