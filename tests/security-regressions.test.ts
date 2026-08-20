import test from "node:test";
import assert from "node:assert/strict";
import { documentVisibilityScope, withDocumentScope } from "../src/lib/services/documentScope";
import { compareAndSetStatus } from "../src/lib/services/transitionGuard";

test("文档搜索条件不会覆盖项目可见范围", () => {
  const scope = documentVisibilityScope(["project-a"]);
  const search = { OR: [{ title: { contains: "机密" } }, { summary: { contains: "机密" } }] };
  const where = withDocumentScope(scope, search);

  assert.deepEqual(where, { AND: [scope, search] });
  assert.deepEqual((where.AND as object[])[0], {
    OR: [{ projectId: null }, { projectId: { in: ["project-a"] } }],
  });
});

test("状态 CAS 同时包含实体 ID 与旧状态", async () => {
  let received: unknown;
  const ok = await compareAndSetStatus({
    async updateMany(args) {
      received = args;
      return { count: 1 };
    },
  }, "ecr-1", "SUBMITTED", "APPROVED");

  assert.equal(ok, true);
  assert.deepEqual(received, {
    where: { id: "ecr-1", status: "SUBMITTED" },
    data: { status: "APPROVED" },
  });
});

test("状态 CAS 在并发认领失败时返回 false", async () => {
  const ok = await compareAndSetStatus({ async updateMany() { return { count: 0 }; } }, "eco-1", "PENDING", "APPROVED");
  assert.equal(ok, false);
});
