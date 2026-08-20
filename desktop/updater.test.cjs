"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, expectedHash } = require("./updater");

test("compareVersions 正确比较不同长度的语义版本", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
});

test("expectedHash 只接受 SHA256SUMS 中完全匹配的资产名", () => {
  const hash = "a".repeat(64);
  const manifest = `${hash}  PLM-Workspace-v1.0.1-portable.exe\n${"b".repeat(64)}  other.zip\n`;
  assert.equal(expectedHash(manifest, "PLM-Workspace-v1.0.1-portable.exe"), hash);
  assert.throws(() => expectedHash(manifest, "PLM-Workspace-v1.0.1.exe"), /校验清单中没有/);
});

test("expectedHash 拒绝非 SHA-256 内容", () => {
  assert.throws(() => expectedHash("1234  package.exe", "package.exe"), /校验清单中没有/);
});
