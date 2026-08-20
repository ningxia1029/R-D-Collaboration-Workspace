import test from "node:test";
import assert from "node:assert/strict";
import { roleCanComment, roleHasPerm } from "../src/lib/rbac";
import type { PermissionCode, RoleName } from "../src/lib/constants";

const domains: Record<string, { read: PermissionCode; write: PermissionCode }> = {
  project: { read: "project:read", write: "project:update" },
  task: { read: "task:read", write: "task:create" },
  bom: { read: "bom:read", write: "bom:create" },
  eco: { read: "eco:read", write: "eco:create" },
  ecr: { read: "ecr:read", write: "ecr:create" },
  knowledge: { read: "kb:read", write: "kb:create" },
};

test("admin 与 pm 具备验收域的读写权限", () => {
  for (const role of ["admin", "pm"] satisfies RoleName[]) {
    for (const [domain, permissions] of Object.entries(domains)) {
      assert.equal(roleHasPerm(role, permissions.read), true, `${role} 应可读取 ${domain}`);
      assert.equal(roleHasPerm(role, permissions.write), true, `${role} 应可写入 ${domain}`);
    }
  }
});

test("engineer 只能维护自己的任务，但可创建工程数据", () => {
  assert.equal(roleHasPerm("engineer", "project:update"), false);
  assert.equal(roleHasPerm("engineer", "task:create"), false);
  assert.equal(roleHasPerm("engineer", "task:update"), false);
  assert.equal(roleHasPerm("engineer", "task:update_own"), true);
  for (const permission of ["bom:create", "bom:update", "eco:create", "ecr:create", "ecr:submit", "kb:create", "kb:update"] satisfies PermissionCode[]) {
    assert.equal(roleHasPerm("engineer", permission), true, `engineer 缺少 ${permission}`);
  }
  for (const permission of ["eco:approve", "ecr:approve", "kb:delete"] satisfies PermissionCode[]) {
    assert.equal(roleHasPerm("engineer", permission), false, `engineer 不应拥有 ${permission}`);
  }
});

test("viewer 在项目、任务、BOM、变更与知识库中保持只读", () => {
  for (const [domain, permissions] of Object.entries(domains)) {
    assert.equal(roleHasPerm("viewer", permissions.read), true, `viewer 应可读取 ${domain}`);
    assert.equal(roleHasPerm("viewer", permissions.write), false, `viewer 不应写入 ${domain}`);
  }
  for (const permission of ["task:update_own", "bom:update", "eco:approve", "ecr:submit", "kb:update"] satisfies PermissionCode[]) {
    assert.equal(roleHasPerm("viewer", permission), false, `viewer 不应拥有 ${permission}`);
  }
  assert.equal(roleCanComment("viewer"), false);
  assert.equal(roleCanComment("engineer"), true);
});
